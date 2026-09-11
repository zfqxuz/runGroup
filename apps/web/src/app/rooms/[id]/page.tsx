import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CombatState } from "@touhou/combat";
import CombatBoard from "@/components/room/CombatBoard";
import RoomCombatPanel from "@/components/room/RoomCombatPanel";
import RoomConfigPanel from "@/components/room/RoomConfigPanel";
import RoomGameStatePanel from "@/components/room/RoomGameStatePanel";
import RoomAdvancementPanel from "@/components/room/RoomAdvancementPanel";
import RoomInfoPanel from "@/components/room/RoomInfoPanel";
import RoomPlay from "@/components/room/RoomPlay";
import SceneBoard from "@/components/room/SceneBoard";
import { pauseGameAction } from "@/server/actions/room";
import { auth } from "@/server/auth";
import { loadEffectivePack } from "@/server/rules/loader";
import { loadGameModuleView } from "@/server/modules/revision";
import { loadSceneView } from "@/server/scene/load";
import { combatFeatureFlags, loadAttackSkillsByParticipant } from "@/server/combat/options";
import { prisma } from "@/server/db/prisma";
import { advancementView, gameStateView, growthCheckView } from "@/server/game/view";
import { buildEffectiveSkills } from "@/server/character/skills";
import type { ChatChannel, ChatKind, ChatMessage, RoomMemberView } from "@/shared/socket";

export const dynamic = "force-dynamic";

interface StoredContent {
  text?: string;
  kind?: string;
  dice?: ChatMessage["dice"];
}

export default async function RoomPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { state?: string; advancement?: string; growth?: string; error?: string; clue?: string; note?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: {
      activeCharacter: { select: { id: true, name: true, race: true } },
      room: {
        include: {
          members: {
            include: { user: { select: { username: true, displayName: true } } },
            orderBy: { joinedAt: "asc" }
          }
        }
      }
    }
  });
  if (membership === null) notFound();
  const room = membership.room;
  const isKP = membership.role === "KP";
  if (room.status === "LOBBY" || room.status === "PAUSED") redirect("/rooms/" + room.id + "/prepare");

  const rows = await prisma.message.findMany({
    where: {
      roomId: room.id,
      ...(isKP ? {} : { channel: { not: "KP_ONLY" as const } }),
      OR: [
        { channel: { not: "WHISPER" as const } },
        { userId: session.user.id },
        { targetId: session.user.id }
      ]
    },
    include: { user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  const initialMessages: ChatMessage[] = rows
    .slice()
    .reverse()
    .map((row) => {
      const content = (row.content ?? {}) as StoredContent;
      return {
        id: row.id,
        userId: row.userId,
        username: row.user.username,
        displayName: row.user.displayName ?? row.user.username,
        channel: row.channel as ChatChannel,
        kind: (content.kind ?? row.type) as ChatKind,
        text: content.text ?? "",
        dice: content.dice ?? null,
        targetId: row.targetId,
        createdAt: row.createdAt.toISOString()
      };
    });

  const initialMembers: RoomMemberView[] = room.members.map((member) => ({
    userId: member.userId,
    username: member.user.username,
    displayName: member.user.displayName ?? member.user.username,
    role: member.role
  }));

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skillOptions = effective.compiled.skills.map((skill) => ({ id: skill.id, name: skill.name }));

  const activeCombat = await prisma.combat.findFirst({
    where: { roomId: room.id, endedAt: null },
    select: { id: true }
  });
  const activeGame = await prisma.game.findFirst({
    where: { roomId: room.id, status: { in: ["PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    include: {
      state: true,
      characters: {
        include: { character: true },
        orderBy: { id: "asc" }
      }
    }
  });
  const gameState = activeGame?.state === null || activeGame?.state === undefined ? null : gameStateView(activeGame.state);
  const gameModule = await loadGameModuleView(activeGame);
  const activeScene = await loadSceneView(room.id);
  const canSeeAllCharacters = isKP || room.characterVisibility !== "PRIVATE";
  const visibleGameCharacters =
    activeGame === null
      ? []
      : canSeeAllCharacters
        ? activeGame.characters
        : activeGame.characters.filter((item) => item.userId === session.user.id);
  const [dbChapters, dbScenes, dbEncounters] = activeGame === null
    ? [[], [], []]
    : await Promise.all([
        activeGame.moduleId === null
          ? Promise.resolve([])
          : prisma.moduleChapter.findMany({
              where: { moduleId: activeGame.moduleId },
              orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
              select: { id: true, title: true, summary: true }
            }),
        prisma.scene.findMany({
          where: { roomId: room.id },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: { id: true, name: true, isActive: true }
        }),
        prisma.encounter.findMany({
          where: { roomId: room.id },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: { id: true, title: true, sceneId: true }
        })
      ]);
  const moduleSections = isKP ? (gameModule?.sections ?? []) : [];
  const structuredChapters = isKP
    ? (gameModule?.structured.chapters ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: typeof item.data.summary === "string" ? item.data.summary : null
      }))
    : [];
  const structuredScenes = (gameModule?.structured.scenes ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    detail: null
  }));
  const structuredEncounters = isKP
    ? (gameModule?.structured.encounters ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: typeof item.data.sceneId === "string" ? "场景 " + item.data.sceneId : null
      }))
    : [];
  const moduleChapters = dbChapters.length > 0
    ? dbChapters.map((item) => ({ id: item.id, title: item.title, detail: item.summary }))
    : structuredChapters;
  const moduleScenesForView = dbScenes.length > 0
    ? dbScenes.map((item) => ({ id: item.id, title: item.name, detail: item.isActive ? "当前激活" : null }))
    : structuredScenes;
  const dbSceneById = new Map(dbScenes.map((item) => [item.id, item]));
  const moduleEncounters = dbEncounters.length > 0
    ? dbEncounters.map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.sceneId === null || item.sceneId === undefined ? null : "场景 " + (dbSceneById.get(item.sceneId)?.name ?? item.sceneId)
      }))
    : structuredEncounters;
  const advancements = activeGame === null
    ? []
    : await prisma.characterAdvancement.findMany({
        where: {
          gameId: activeGame.id,
          ...(canSeeAllCharacters ? {} : { character: { userId: session.user.id } })
        },
        include: {
          character: { select: { name: true } },
          game: { select: { title: true } }
        },
        orderBy: { createdAt: "desc" }
      });
  const advancementRows = advancements.map((item) => advancementView(item));
  const growthCheckRows = activeGame === null
    ? []
    : await prisma.growthCheck.findMany({
        where: {
          gameId: activeGame.id,
          state: "PENDING",
          ...(canSeeAllCharacters ? {} : { character: { userId: session.user.id } })
        },
        include: { character: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
  const growthChecks = growthCheckRows.map((item) => growthCheckView(item));
  const skillNameById = new Map<string, string>();
  for (const skill of effective.compiled.skills) skillNameById.set(skill.id, skill.name);
  const characterSkills = activeGame === null
    ? []
    : visibleGameCharacters.map((item) => {
        const values = buildEffectiveSkills(effective.compiled, item.character);
        const rows = Object.entries(values)
          .map(([id, value]) => ({ id, name: skillNameById.get(id) ?? id, value }))
          .filter((row) => row.value > 0)
          .sort((a, b) => b.value - a.value);
        return { characterId: item.characterId, characterName: item.character.name, skills: rows };
      });

  const clues = await prisma.clue.findMany({
    where: isKP
      ? { roomId: room.id }
      : {
          roomId: room.id,
          OR: [{ isPublic: true }, { discoveredBy: { some: { userId: session.user.id } } }]
        },
    include: {
      _count: { select: { discoveredBy: true } },
      discoveredBy: { where: { userId: session.user.id }, select: { userId: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  const notes = await prisma.note.findMany({
    where: isKP
      ? { roomId: room.id, OR: [{ userId: session.user.id }, { isKPOnly: true }] }
      : { roomId: room.id, userId: session.user.id },
    orderBy: { id: "asc" }
  });
  const handoutAssets = (isKP ? gameModule?.assets ?? [] : [])
    .filter((asset) => asset.kind === "HANDOUT")
    .map((asset) => ({
      id: asset.assetId ?? asset.relativePath,
      title: asset.originalName ?? asset.relativePath,
      url: asset.url
    }));
  const gameCharacterOptions = visibleGameCharacters.map((item) => ({
    id: item.characterId,
    name: item.character.name
  }));

  const combatFeatures = combatFeatureFlags(effective.compiled);
  const attackSkillsByParticipant: Record<string, readonly string[]> = {};
  if (activeCombat === null) {
    // 没有进行中的战斗时保持空表。
  } else {
    const snapshot = await prisma.combatSnapshot.findFirst({
      where: { combatId: activeCombat.id },
      orderBy: { seq: "desc" },
      select: { state: true }
    });
    if (snapshot === null) {
      // 快照缺失时保持空表。
    } else {
      const state = snapshot.state as unknown as CombatState;
      const attackSkills = await loadAttackSkillsByParticipant(
        effective.compiled,
        state.participants.map((participant) => ({
          id: participant.id,
          kind: participant.kind,
          characterId: participant.characterId,
          skills: participant.skills
        }))
      );
      for (const [participantId, skillIds] of attackSkills) {
        attackSkillsByParticipant[participantId] = skillIds;
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/50">
            <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">{room.system}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">{room.status}</span>
            {membership.activeCharacter === null ? null : (
              <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-sakura-400">
                当前角色：{membership.activeCharacter.name}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={"/rooms/" + room.id + "/modules"}
            className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
          >
            团本管理
          </Link>
          <Link
            href={"/rooms/" + room.id + "/scenes"}
            className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
          >
            场景 / 地图
          </Link>
          <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
            我的身份：{membership.role}
          </span>
        </div>
      </header>

      {room.status === "ENDED" ? (
        <p className="rounded-xl border border-white/15 bg-ink-800/50 px-4 py-3 text-xs text-white/50">
          房间已归档，仅保留历史数据与只读视图；发言、掷骰和战斗操作已停止。
        </p>
      ) : null}

      <RoomConfigPanel
        roomId={room.id}
        system={room.system}
        era={room.era}
        chargenMethod={room.chargenMethod}
        rulePackVersionId={room.rulePackVersionId}
        ruleOverride={room.ruleOverride}
        status={room.status}
        inviteCode={room.inviteCode}
        allowPlayerCombatRequest={room.allowPlayerCombatRequest}
        isKP={isKP}
        characterVisibility={room.characterVisibility}
        magicEnabled={room.magicEnabled}
        magicSpellCount={effective.compiled.pack.magic?.spells.length ?? 0}
      />

      {isKP ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-5 py-4">
          <div>
            <p className="text-sm text-white/80">
              {activeGame === null ? "房间状态异常" : "本局：" + activeGame.title}
            </p>
            <p className="mt-0.5 text-[11px] text-white/35">
              {activeGame === null
                ? "当前没有进行中的局，但房间状态不是 LOBBY。可以结束并重置房间。"
                : "暂停会保存当前状态并返回准备页；继续时全员需要重新准备。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeGame === null ? (
              <Link
                href={"/rooms/" + room.id + "/end"}
                className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/10"
              >
                结束并重置房间
              </Link>
            ) : (
              <>
                <form action={pauseGameAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-400/10"
                  >
                    暂停本局
                  </button>
                </form>
                <Link
                  href={"/rooms/" + room.id + "/end"}
                  className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/10"
                >
                  结束本局
                </Link>
              </>
            )}
          </div>
        </section>
      ) : null}

      {gameState === null || activeGame === null ? null : (
        <RoomGameStatePanel
          roomId={room.id}
          gameId={activeGame.id}
          gameTitle={activeGame.title}
          status={activeGame.status}
          state={gameState}
          moduleSections={moduleSections}
          moduleChapters={moduleChapters}
          moduleScenes={moduleScenesForView}
          moduleEncounters={moduleEncounters}
          isKP={isKP}
          saved={searchParams.state === "saved"}
          error={searchParams.error ?? null}
        />
      )}

      {activeGame === null ? null : (
        <RoomAdvancementPanel
          roomId={room.id}
          gameId={activeGame.id}
          isKP={isKP}
          characters={gameCharacterOptions}
          advancements={advancementRows}
          growthChecks={growthChecks}
          characterSkills={characterSkills}
          skillOptions={skillOptions}
          saved={searchParams.advancement === "saved"}
          notice={searchParams.growth ?? null}
          error={searchParams.error ?? null}
        />
      )}

      {activeScene === null ? (
        isKP && room.status !== "ENDED" ? (
          <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-white/80">战术棋盘</h2>
                <p className="mt-1 text-[11px] text-white/35">还没有激活的场景，先到场景 / 地图页面创建并切换。</p>
              </div>
              <Link href={"/rooms/" + room.id + "/scenes"} className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400">
                去创建场景
              </Link>
            </div>
          </section>
        ) : null
      ) : (
        <SceneBoard
          roomId={room.id}
          isKP={isKP}
          currentUserId={session.user.id}
          readOnly={room.status === "ENDED"}
          scene={activeScene}
        />
      )}

      <RoomInfoPanel
        roomId={room.id}
        isKP={isKP}
        readOnly={room.status === "ENDED"}
        clues={clues.map((clue) => ({
          id: clue.id,
          title: clue.title,
          content: clue.content,
          isPublic: clue.isPublic,
          discoveredByMe: clue.discoveredBy.length > 0,
          discoveredCount: clue._count.discoveredBy
        }))}
        notes={notes.map((note) => ({
          id: note.id,
          title: note.title,
          content: note.content,
          isKPOnly: note.isKPOnly,
          isMine: note.userId === session.user.id
        }))}
        handouts={handoutAssets}
        clueStatus={searchParams.clue ?? null}
        noteStatus={searchParams.note ?? null}
      />

      {activeCombat === null ? (
        <RoomCombatPanel
          roomId={room.id}
          isKP={isKP}
          allowPlayerCombatRequest={room.allowPlayerCombatRequest}
        />
      ) : (
        <section id="combat" className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-white/80">战斗进行中</h2>
            <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">
              {room.status}
            </span>
          </div>
          <CombatBoard
            combatId={activeCombat.id}
            isKP={isKP}
            skillOptions={skillOptions}
            system={room.system}
            canCounter={combatFeatures.canCounter}
            canOutOfRule={combatFeatures.canOutOfRule}
            canCastMagic={combatFeatures.canCastMagic}
            magicSpells={(effective.compiled.pack.magic?.spells ?? []).map((spell) => ({
              id: spell.id,
              name: spell.name,
              description: spell.description,
              mpCost: spell.mpCost,
              sanCost: spell.sanCost,
              damage: spell.damage,
              target: spell.target
            }))}
            attackSkillsByParticipant={attackSkillsByParticipant}
          />
        </section>
      )}

      <RoomPlay
        roomId={room.id}
        currentUserId={session.user.id}
        isKP={isKP}
        initialMembers={initialMembers}
        initialMessages={initialMessages}
        initialGameStateVersion={gameState?.version ?? 0}
        initialCombatId={activeCombat?.id ?? null}
      />
    </main>
  );
}
