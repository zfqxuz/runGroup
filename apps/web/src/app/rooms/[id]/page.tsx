import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import KpPrepPanel from "@/components/room/KpPrepPanel";
import RoomAdvancementPanel from "@/components/room/RoomAdvancementPanel";
import RoomGameStatePanel from "@/components/room/RoomGameStatePanel";
import RoomInfoPanel from "@/components/room/RoomInfoPanel";
import RoomPlay from "@/components/room/RoomPlay";
import SceneBoard from "@/components/room/SceneBoard";
import { pauseGameAction } from "@/server/actions/room";
import { auth } from "@/server/auth";
import { buildEffectiveSkills } from "@/server/character/skills";
import { prisma } from "@/server/db/prisma";
import { advancementView, gameStateView, growthCheckView } from "@/server/game/view";
import { loadGameModuleView } from "@/server/modules/revision";
import { loadRoomMemberViews } from "@/server/room/member-view";
import { loadEffectivePack } from "@/server/rules/loader";
import { loadSceneView } from "@/server/scene/load";
import type { ChatChannel, ChatKind, ChatMessage, TradeOfferSummary } from "@/shared/socket";

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
      room: true
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

  const initialMembers = await loadRoomMemberViews({
    roomId: room.id,
    viewerUserId: session.user.id,
    isKP,
    roomVisibility: room.characterVisibility
  });
  // 右侧“房间视角”始终按普通玩家可见性渲染，即使观看者是 KP。
  const playerInitialMembers = isKP
    ? await loadRoomMemberViews({
        roomId: room.id,
        viewerUserId: session.user.id,
        isKP: false,
        roomVisibility: room.characterVisibility
      })
    : initialMembers;

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
  const activeScene = await loadSceneView(room.id, undefined, { userId: session.user.id, isKP });
  const canSeeAllCharacters = isKP || room.characterVisibility !== "PRIVATE";
  const visibleGameCharacters =
    activeGame === null
      ? []
      : canSeeAllCharacters
        ? activeGame.characters
        : activeGame.characters.filter((item) => item.userId === session.user.id);
  const [dbRoomChapters, dbChapters, dbScenes, dbEncounters] = activeGame === null
    ? [[], [], [], []]
    : await Promise.all([
        isKP
          ? prisma.roomChapter.findMany({
              where: { roomId: room.id },
              orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
              select: { id: true, title: true, summary: true }
            })
          : Promise.resolve([]),
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
          select: { id: true, title: true, sceneId: true, roomChapterId: true }
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
  const moduleChapters = dbRoomChapters.length > 0
    ? dbRoomChapters.map((item) => ({ id: item.id, title: item.title, detail: item.summary }))
    : dbChapters.length > 0
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
          OR: [
            { isPublic: true },
            { discoveredBy: { some: { userId: session.user.id } } },
            { shares: { some: { userId: session.user.id } } }
          ]
        },
    include: {
      _count: { select: { discoveredBy: true } },
      discoveredBy: { where: { userId: session.user.id }, select: { userId: true } },
      shares: { select: { userId: true } }
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
  const sceneNpcCards = await prisma.card.findMany({
    where: { roomId: room.id, scope: "ROOM", type: "NPC" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" }
  });
  const gameCharacterUnits = (activeGame?.characters ?? []).map((item) => ({
    ref: "character:" + item.characterId,
    name: item.character.name,
    kind: "PLAYER" as const,
    userId: item.userId
  }));
  const approvedEntriesForUnits = await prisma.roomCharacterEntry.findMany({
    where: { roomId: room.id, status: "APPROVED" },
    include: { character: { select: { name: true, userId: true } } },
    orderBy: { submittedAt: "asc" }
  });
  const allCharacterUnits = gameCharacterUnits.length > 0
    ? gameCharacterUnits
    : approvedEntriesForUnits.map((entry) => ({
        ref: "character:" + entry.characterId,
        name: entry.character.name,
        kind: "PLAYER" as const,
        userId: entry.character.userId
      }));
  const npcUnits = sceneNpcCards.map((card) => ({
    ref: "npc:" + card.id,
    name: card.name,
    kind: "NPC" as const,
    userId: null
  }));
  const ownCharacterUnits = allCharacterUnits.filter((item) => item.userId === session.user.id);
  const placeableSceneUnits = isKP ? [...allCharacterUnits, ...npcUnits] : ownCharacterUnits;

  const visionShareRows = await prisma.roomVisionShare.findMany({
    where: { roomId: room.id },
    select: { userId: true, targetUserId: true }
  });
  const sharedUserIds = visionShareRows
    .filter((row) => row.userId === session.user.id || row.targetUserId === session.user.id)
    .map((row) => (row.userId === session.user.id ? row.targetUserId : row.userId))
    .filter((userId) => userId !== session.user.id);
  const backgroundAssets = [
    ...(gameModule?.assets ?? [])
      .filter((asset) => asset.assetId !== null && /[.](?:png|jpe?g|webp|gif|avif|bmp|tiff?)$/i.test(asset.relativePath))
      .map((asset) => ({
        id: asset.assetId as string,
        label: asset.originalName ?? asset.relativePath,
        url: asset.url
      })),
    ...(await prisma.asset.findMany({
      where: { roomId: room.id, type: { in: ["MAP", "SCENE_BG"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, originalName: true, url: true }
    })).map((asset) => ({ id: asset.id, label: asset.originalName, url: asset.url }))
  ];

  const playerOwnCharacterIds = new Set(
    (activeGame?.characters ?? [])
      .filter((item) => item.userId === session.user.id)
      .map((item) => item.characterId)
  );
  const playerAdvancementRows = advancementRows.filter((row) => playerOwnCharacterIds.has(row.characterId));
  const playerGrowthChecks = growthChecks.filter((row) => playerOwnCharacterIds.has(row.characterId));
  const playerCharacterSkills = characterSkills.filter((row) => playerOwnCharacterIds.has(row.characterId));
  const playerGameCharacterOptions = gameCharacterOptions.filter((row) => playerOwnCharacterIds.has(row.id));
  const playerClues = isKP
    ? clues.filter(
        (clue) =>
          clue.isPublic ||
          clue.discoveredBy.length > 0 ||
          clue.shares.some((share) => share.userId === session.user.id)
      )
    : clues;
  const playerNotes = notes.filter((note) => note.userId === session.user.id);
  const playerHandouts = handoutAssets.filter(() => false);

  const myTradeCards =
    membership.activeCharacterId === null
      ? []
      : await prisma.card.findMany({
          where: {
            ownerId: session.user.id,
            characterId: membership.activeCharacterId
          },
          select: { id: true, name: true, type: true },
          orderBy: { createdAt: "asc" }
        });

  const tradeRows = await prisma.tradeOffer.findMany({
    where: {
      roomId: room.id,
      status: "PENDING",
      OR: [{ fromUserId: session.user.id }, { toUserId: session.user.id }]
    },
    include: {
      from: { select: { username: true, displayName: true } },
      to: { select: { username: true, displayName: true } },
      card: { select: { name: true, subtitle: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  const initialTrades: TradeOfferSummary[] = tradeRows.map((row) => {
    const incoming = row.toUserId === session.user.id;
    const counterpart = incoming ? row.from : row.to;
    return {
      id: row.id,
      direction: incoming ? "INCOMING" : "OUTGOING",
      counterpartId: incoming ? row.fromUserId : row.toUserId,
      counterpartName: counterpart.displayName ?? counterpart.username,
      cardName: row.card.name,
      cardSubtitle: row.card.subtitle,
      note: row.note,
      status: row.status,
      createdAt: row.createdAt.toISOString()
    };
  });

  const shareableClues = playerClues.map((clue) => ({
    id: clue.id,
    title: clue.title,
    isPublic: clue.isPublic
  }));
  const clueMemberOptions = initialMembers
    .filter((member) => member.role !== "KP")
    .map((member) => ({ userId: member.userId, displayName: member.displayName, role: member.role }));
  const kpChapterTitle = gameState?.currentChapterId === null || gameState?.currentChapterId === undefined
    ? null
    : moduleChapters.find((item) => item.id === gameState.currentChapterId)?.title ?? gameState.currentChapterId;
  const kpEncounterTitle = gameState?.currentEncounterId === null || gameState?.currentEncounterId === undefined
    ? null
    : moduleEncounters.find((item) => item.id === gameState.currentEncounterId)?.title ?? gameState.currentEncounterId;
  const kpPrepClues = clues.map((clue) => ({
    id: clue.id,
    title: clue.title,
    content: clue.content,
    isPublic: clue.isPublic,
    discoveredCount: clue._count.discoveredBy,
    sharedWithIds: clue.shares.map((share) => share.userId)
  }));


  const playerContent = (
    <div className="flex min-w-0 flex-col gap-6">
      {activeCombat === null ? null : (
        <section className="mx-auto w-full max-w-4xl rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-amber-200">战斗进行中</h2>
            <Link
              href={"/rooms/" + room.id + "/combat/" + activeCombat.id}
              className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-300"
            >
              进入战斗页面
            </Link>
          </div>
        </section>
      )}

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
          isKP={false}
          saved={searchParams.state === "saved"}
          error={searchParams.error ?? null}
        />
      )}

      {activeGame === null ? null : (
        <RoomAdvancementPanel
          roomId={room.id}
          gameId={activeGame.id}
          isKP={false}
          characters={playerGameCharacterOptions}
          advancements={playerAdvancementRows}
          growthChecks={playerGrowthChecks}
          characterSkills={playerCharacterSkills}
          skillOptions={skillOptions}
          saved={searchParams.advancement === "saved"}
          notice={searchParams.growth ?? null}
          error={searchParams.error ?? null}
        />
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] lg:items-stretch">
      {activeScene === null ? null : (
        <SceneBoard
          roomId={room.id}
          isKP={false}
          currentUserId={session.user.id}
          readOnly={room.status === "ENDED"}
          returnTo={"/rooms/" + room.id}
          scenes={dbScenes.map((scene) => ({ id: scene.id, name: scene.name, isActive: scene.isActive }))}
          units={isKP ? [] : placeableSceneUnits}
          canControlAll={isKP}
          allowPlayerCombatRequest={room.allowPlayerCombatRequest}
          activeCombatId={activeCombat?.id ?? null}
          members={playerInitialMembers}
          sharedUserIds={sharedUserIds}
          backgroundAssets={backgroundAssets}
          tradeCards={myTradeCards.map((card) => ({ id: card.id, name: card.name, type: card.type }))}
          shareableClues={shareableClues}
          fill
          scene={activeScene}
        />
      )}


      <RoomPlay
        roomId={room.id}
        currentUserId={session.user.id}
        isKP={false}
        initialMembers={playerInitialMembers}
        initialMessages={initialMessages}
        initialGameStateVersion={gameState?.version ?? 0}
        initialCombatId={activeCombat?.id ?? null}
        roomStatus={room.status}
        characterVisibility={room.characterVisibility}
        allowPlayerCombatRequest={room.allowPlayerCombatRequest}
        initialTrades={initialTrades}
        tradeCards={myTradeCards.map((card) => ({ id: card.id, name: card.name, type: card.type }))}
        shareableClues={shareableClues}
        playerPerspective={isKP}
      />

      </section>

      <RoomInfoPanel
        roomId={room.id}
        isKP={false}
        readOnly={room.status === "ENDED"}
        clues={playerClues.map((clue) => ({
          id: clue.id,
          title: clue.title,
          content: clue.content,
          isPublic: clue.isPublic,
          discoveredByMe: clue.discoveredBy.length > 0,
          discoveredCount: clue._count.discoveredBy,
          sharedWithIds: clue.shares.map((share) => share.userId),
          sharedWithMe: clue.shares.some((share) => share.userId === session.user.id)
        }))}
        members={clueMemberOptions}
        notes={playerNotes.map((note) => ({
          id: note.id,
          title: note.title,
          content: note.content,
          isKPOnly: note.isKPOnly,
          isMine: note.userId === session.user.id
        }))}
        handouts={playerHandouts}
        clueStatus={searchParams.clue ?? null}
        noteStatus={searchParams.note ?? null}
      />

    </div>
  );

  const kpActionPanel = isKP ? (
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
  ) : null;

  const isKpSplit = isKP && (room.status === "PLAYING" || room.status === "COMBAT");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-6 py-12">
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
          {isKP ? (
            <Link
              href={"/rooms/" + room.id + "/modules"}
              className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
            >
              团本编辑与素材
            </Link>
          ) : null}
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

      {isKpSplit ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-sakura-500/30 bg-sakura-500/5 px-4 py-2 text-xs text-sakura-200">
            KP 分屏模式：左侧为准备区（场景切换、线索公布），右侧为玩家实际看到的房间视角。
          </p>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
            <aside className="flex flex-col gap-6 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:pr-1">
              {kpActionPanel}
              {activeGame === null || gameState === null ? (
                <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5 text-xs text-white/50">
                  当前没有可用的局内状态，暂时无法进入 KP 准备区。
                </section>
              ) : (
                <KpPrepPanel
                  roomId={room.id}
                  gameId={activeGame.id}
                  gameTitle={activeGame.title}
                  state={gameState}
                  sceneOptions={moduleScenesForView.map((scene) => ({ id: scene.id, title: scene.title, detail: scene.detail }))}
                  sections={moduleSections}
                  chapterOptions={moduleChapters.map((chapter) => ({ id: chapter.id, title: chapter.title, detail: chapter.detail }))}
                  encounterOptions={moduleEncounters.map((encounter) => ({ id: encounter.id, title: encounter.title, detail: encounter.detail }))}
                  chapterTitle={kpChapterTitle}
                  encounterTitle={kpEncounterTitle}
                  clues={kpPrepClues}
                  members={clueMemberOptions}
                  sceneId={activeScene?.id ?? null}
                  mapId={activeScene?.map?.id ?? null}
                  mapBackgroundUrl={activeScene?.map?.backgroundUrl ?? null}
                  fogEnabled={activeScene?.map?.showFog ?? false}
                  backgroundAssets={backgroundAssets}
                  units={placeableSceneUnits}
                />
              )}
            </aside>
            <section className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-spirit-400/25 bg-spirit-400/5 px-4 py-2">
                <h2 className="text-sm font-medium text-spirit-200">房间视角（与普通玩家一致）</h2>
                <span className="text-[10px] text-white/35">此区域不包含 KP 专属控件</span>
              </div>
              {playerContent}
            </section>
          </div>
        </div>
      ) : (
        playerContent
      )}
    </main>
  );
}
