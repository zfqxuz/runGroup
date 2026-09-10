import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CombatState } from "@touhou/combat";
import CombatBoard from "@/components/room/CombatBoard";
import RoomCombatPanel from "@/components/room/RoomCombatPanel";
import RoomConfigPanel from "@/components/room/RoomConfigPanel";
import RoomGameStatePanel from "@/components/room/RoomGameStatePanel";
import RoomAdvancementPanel from "@/components/room/RoomAdvancementPanel";
import RoomPlay from "@/components/room/RoomPlay";
import { endGameAction, pauseGameAction } from "@/server/actions/room";
import { auth } from "@/server/auth";
import { loadEffectivePack } from "@/server/rules/loader";
import { combatFeatureFlags, loadAttackSkillsByParticipant } from "@/server/combat/options";
import { prisma } from "@/server/db/prisma";
import { advancementView, gameStateView } from "@/server/game/view";
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
  searchParams: { state?: string; advancement?: string; error?: string };
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
    where: isKP ? { roomId: room.id } : { roomId: room.id, channel: { not: "KP_ONLY" } },
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
        include: { character: { select: { id: true, name: true } } },
        orderBy: { id: "asc" }
      }
    }
  });
  const gameState = activeGame?.state === null || activeGame?.state === undefined ? null : gameStateView(activeGame.state);
  const activeModule =
    activeGame?.moduleId === null || activeGame?.moduleId === undefined
      ? await prisma.module.findFirst({ where: { roomId: room.id }, orderBy: { id: "asc" }, select: { content: true } })
      : await prisma.module.findUnique({ where: { id: activeGame.moduleId }, select: { content: true } });
  const rawSections = activeModule?.content === null || activeModule?.content === undefined
    ? []
    : ((activeModule.content as { sections?: unknown }).sections ?? []);
  const moduleSections = Array.isArray(rawSections)
    ? rawSections.filter((section): section is string => typeof section === "string")
    : [];
  const advancements = activeGame === null
    ? []
    : await prisma.characterAdvancement.findMany({
        where: { gameId: activeGame.id },
        include: {
          character: { select: { name: true } },
          game: { select: { title: true } }
        },
        orderBy: { createdAt: "desc" }
      });
  const advancementRows = advancements.map((item) => advancementView(item));
  const gameCharacterOptions = activeGame?.characters.map((item) => ({
    id: item.characterId,
    name: item.character.name
  })) ?? [];

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
          <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
            我的身份：{membership.role}
          </span>
        </div>
      </header>

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
      />

      {isKP ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-5 py-4">
          <div>
            <p className="text-sm text-white/80">本局：{activeGame?.title ?? room.name}</p>
            <p className="mt-0.5 text-[11px] text-white/35">
              暂停会保存当前状态并返回准备页；继续时全员需要重新准备。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={pauseGameAction}>
              <input type="hidden" name="roomId" value={room.id} />
              <button
                type="submit"
                className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-400/10"
              >
                暂停本局
              </button>
            </form>
            <form action={endGameAction}>
              <input type="hidden" name="roomId" value={room.id} />
              <button
                type="submit"
                className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/10"
              >
                结束本局
              </button>
            </form>
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
          skillOptions={skillOptions}
          saved={searchParams.advancement === "saved"}
        />
      )}

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
            attackSkillsByParticipant={attackSkillsByParticipant}
          />
        </section>
      )}

      <RoomPlay
        roomId={room.id}
        isKP={isKP}
        initialMembers={initialMembers}
        initialMessages={initialMessages}
        initialGameStateVersion={gameState?.version ?? 0}
        initialCombatId={activeCombat?.id ?? null}
      />
    </main>
  );
}
