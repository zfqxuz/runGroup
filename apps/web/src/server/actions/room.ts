"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { builtinRegistry, resolveRulePack, type CombatMode } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ensureModuleRevision } from "@/server/modules/revision";
import { applyMagicRulesToRoom, disableMagicRulesInRoom } from "@/server/modules/magic";
import { applyAdvancement, parseAdvancementRows } from "@/server/game/advancement";
import { resolveGameGrowthChecks } from "@/server/game/growth";
import { emitAdvancementUpdate, emitRoomRefresh, emitRoomUpdate } from "@/server/realtime";
import { clearCombatRuntime, hasCombatRuntime, loadCombatRuntime } from "@/server/combat/runtime";
import { saveCombatState } from "@/server/combat/setup";

function generateInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const BUILTIN_BY_SYSTEM: Record<string, string> = {
  COC7: "coc7-baseline",
  TOUHOU: "touhou-ext"
};

export interface RoomSetupOptions {
  readonly name: string;
  readonly system: "COC7" | "TOUHOU";
  readonly chargenMethod: string;
  readonly era: string | null;
  readonly combatMode: CombatMode;
  readonly disabledEvents: readonly string[];
}

export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (name.length === 0) redirect("/rooms/new?error=name");

  const system = formData.get("system") === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(BUILTIN_BY_SYSTEM[system] ?? "coc7-baseline", builtinRegistry());

  const requestedEra = String(formData.get("era") ?? "");
  const era =
    system === "TOUHOU"
      ? null
      : requestedEra === "CLASSIC"
        ? "CLASSIC"
        : "MODERN";

  // 服务端查包拿真实的方法定义，不接受前端传 JSON —— 否则等于让客户端改规则
  const methodId = String(formData.get("chargenMethod") ?? "");
  const method = pack.attributes.methods.find((item) => item.id === methodId);
  if (method === undefined) redirect("/rooms/new?error=method");

  const requestedMode = formData.get("combatMode") === "INITIATIVE" ? "INITIATIVE" : "ATB";
  const combatMode: CombatMode = requestedMode;

  // 只允许关闭真实存在的事件，否则合并后会产生缺少 label 的非法事件
  const requested = formData.getAll("disabledEvents").map((value) => String(value));
  const disabledEvents = requested.filter(
    (id) => pack.combat.events[id] !== undefined
  );

  const allowRaw = formData.get("allowPlayerCombatRequest");
  const characterVisibilityRaw = String(formData.get("characterVisibility") ?? "PUBLIC");
  const characterVisibility = characterVisibilityRaw === "PRIVATE" ? "PRIVATE" : "PUBLIC";
  const requestedModuleId = String(formData.get("moduleId") ?? "").trim();
  let selectedModuleId: string | null = null;
  if (requestedModuleId.length > 0) {
    const moduleRecord = await prisma.module.findUnique({
      where: { id: requestedModuleId },
      select: { id: true, ownerId: true, isPublished: true }
    });
    if (moduleRecord !== null && (moduleRecord.isPublished || moduleRecord.ownerId === session.user.id)) {
      selectedModuleId = moduleRecord.id;
    }
  }

  const ruleOverride: Record<string, unknown> = {
    attributes: { methods: [method] },
    combat: {
      mode: combatMode,
      events: Object.fromEntries(
        disabledEvents.map((id) => [id, { defaultEnabled: false }])
      )
    }
  };

  const room = await prisma.room.create({
    data: {
      name,
      system,
      ownerId: session.user.id,
      inviteCode: generateInviteCode(),
      chargenMethod: method.id,
      era,
      allowPlayerCombatRequest: allowRaw === null ? true : String(allowRaw) === "1",
      characterVisibility,
      selectedModuleId,
      ruleOverride: ruleOverride as never,
      members: { create: { userId: session.user.id, role: "KP" } }
    },
    select: { id: true }
  });

  redirect("/rooms/" + room.id);
}


export async function joinRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const inviteCode = String(formData.get("inviteCode") ?? "").trim().toUpperCase();
  if (inviteCode.length === 0) redirect("/?error=invite");

  const room = await prisma.room.findUnique({ where: { inviteCode } });
  if (room === null) redirect("/?error=invite");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: session.user.id } }
  });
  if (membership === null) {
    await prisma.roomMember.create({
      data: { roomId: room.id, userId: session.user.id, role: "PLAYER" }
    });
  }

  revalidatePath("/");
  revalidatePath("/rooms/" + room.id + "/prepare");
  revalidatePath("/rooms/" + room.id);
  redirect(room.status === "LOBBY" ? "/rooms/" + room.id + "/prepare" : "/rooms/" + room.id);
}

export async function toggleReadyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { id: true, ready: true }
  });
  if (membership === null) redirect("/");
  await prisma.roomMember.update({
    where: { id: membership.id },
    data: { ready: membership.ready === false }
  });
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "ready");
  redirect("/rooms/" + roomId + "/prepare");
}

export async function setActiveCharacterAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const characterId = String(formData.get("characterId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { id: true, role: true }
  });
  if (membership === null) redirect("/");
  if (membership.role === "SPECTATOR") redirect("/rooms/" + roomId + "/prepare?error=character");

  if (characterId.length === 0) {
    await prisma.roomMember.update({ where: { id: membership.id }, data: { activeCharacterId: null } });
  } else {
    const entry = await prisma.roomCharacterEntry.findUnique({
      where: { roomId_characterId: { roomId, characterId } },
      include: { character: { select: { userId: true } } }
    });
    if (entry === null || entry.status !== "APPROVED" || entry.character.userId !== session.user.id) {
      redirect("/rooms/" + roomId + "/prepare?error=character");
    }
    await prisma.roomMember.update({ where: { id: membership.id }, data: { activeCharacterId: characterId } });
  }

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "active-character");
  redirect("/rooms/" + roomId + "/prepare");
}

export async function setCharacterVisibilityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true, room: { select: { status: true } } }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);
  const raw = String(formData.get("characterVisibility") ?? "PUBLIC");
  const characterVisibility = raw === "PRIVATE" ? "PRIVATE" : "PUBLIC";
  await prisma.room.update({ where: { id: roomId }, data: { characterVisibility } });
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "visibility");
  const inLobby = membership.room.status === "LOBBY" || membership.room.status === "PAUSED";
  redirect(inLobby ? "/rooms/" + roomId + "/prepare?settings=visibility" : "/rooms/" + roomId);
}

/** 玩家主动公开 / 隐藏自己的角色数值（仅影响 PRIVATE 房间中的其他玩家）。 */
export async function setStatsPublicAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const enabled = String(formData.get("enabled") ?? "0") === "1";
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { id: true, room: { select: { status: true } } }
  });
  if (membership === null) redirect("/rooms/" + roomId);
  await prisma.roomMember.update({
    where: { id: membership.id },
    data: { statsPublic: enabled }
  });
  // 正在进行的战斗 view 有运行时缓存，必须清掉才能立即反映公开状态。
  const activeCombat = await prisma.combat.findFirst({
    where: { roomId, endedAt: null },
    select: { id: true }
  });
  if (activeCombat !== null) clearCombatRuntime(activeCombat.id);
  revalidatePath("/rooms/" + roomId);
  emitRoomRefresh(roomId, "stats-public");
  redirect("/rooms/" + roomId);
}

export async function setRoomMagicEnabledAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true, room: { select: { status: true } } }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);
  const enabled = String(formData.get("enabled") ?? "0") === "1";
  await prisma.room.update({ where: { id: roomId }, data: { magicEnabled: enabled } });
  if (enabled) await applyMagicRulesToRoom(roomId);
  else await disableMagicRulesInRoom(roomId);
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "magic");
  const inLobby = membership.room.status === "LOBBY" || membership.room.status === "PAUSED";
  redirect(inLobby ? "/rooms/" + roomId + "/prepare?settings=magic" : "/rooms/" + roomId);
}

export async function startRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      status: true,
      selectedModuleId: true,
      members: { select: { role: true, ready: true } }
    }
  });
  if (room === null) redirect("/");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null) redirect("/");
  if (membership.role !== "KP") redirect("/rooms/" + roomId + "/prepare");
  if (room.status !== "LOBBY" && room.status !== "PAUSED") redirect("/rooms/" + roomId);

  const required = room.members.filter((member) => member.role !== "SPECTATOR");
  const notReady = required.filter((member) => member.ready === false);
  if (notReady.length > 0) redirect("/rooms/" + roomId + "/prepare?error=ready");

  const players = await prisma.roomMember.findMany({
    where: { roomId, role: "PLAYER" },
    select: { id: true, userId: true, activeCharacterId: true }
  });
  const approvedEntries = await prisma.roomCharacterEntry.findMany({
    where: { roomId, status: "APPROVED" },
    include: { character: true },
    orderBy: { submittedAt: "asc" }
  });
  const approvedByUser = new Map<string, typeof approvedEntries>();
  for (const entry of approvedEntries) {
    const list = approvedByUser.get(entry.character.userId) ?? [];
    list.push(entry);
    approvedByUser.set(entry.character.userId, list);
  }
  if (players.some((player) => approvedByUser.has(player.userId) === false)) {
    redirect("/rooms/" + roomId + "/prepare?error=character");
  }

  const activeGame = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" }
  });

  if (activeGame !== null && activeGame.status === "PAUSED") {
    if (activeGame.moduleId !== null) {
      const activePreset = await prisma.roomPresetApplication.findFirst({
        where: { roomId, status: "ACTIVE" },
        select: { moduleId: true }
      });
      if (activePreset === null || activePreset.moduleId !== activeGame.moduleId) {
        redirect("/rooms/" + roomId + "/prepare?error=preset-not-applied");
      }
    }
    await applyMagicRulesToRoom(roomId, activeGame.moduleId);
    const missingRevision = activeGame.moduleRevisionId === null && activeGame.moduleId !== null;
    const revision = missingRevision ? await ensureModuleRevision(activeGame.moduleId as string) : null;
    await prisma.game.update({
      where: { id: activeGame.id },
      data: {
        status: "PLAYING",
        moduleRevisionId: revision === null ? activeGame.moduleRevisionId : revision.id
      }
    });
    await prisma.gameState.upsert({
      where: { gameId: activeGame.id },
      update: { paused: false },
      create: {
        gameId: activeGame.id,
        moduleId: activeGame.moduleId,
        paused: false
      }
    });
  } else if (activeGame === null) {
    const requestedModuleId = String(formData.get("moduleId") ?? "");
    const candidateIds = [requestedModuleId, room.selectedModuleId ?? ""].filter((id) => id.length > 0);
    let roomModule: { id: string; title: string; version: string } | null = null;
    for (const candidateId of candidateIds) {
      const candidate = await prisma.module.findUnique({
        where: { id: candidateId },
        select: { id: true, title: true, version: true, roomId: true, isPublished: true }
      });
      if (candidate !== null && (candidate.roomId === roomId || candidate.isPublished)) {
        roomModule = { id: candidate.id, title: candidate.title, version: candidate.version };
        break;
      }
    }
    if (roomModule === null) {
      roomModule = await prisma.module.findFirst({
        where: { roomId },
        orderBy: { id: "asc" },
        select: { id: true, title: true, version: true }
      });
    }
    if (roomModule !== null) {
      const activePreset = await prisma.roomPresetApplication.findFirst({
        where: { roomId, status: "ACTIVE" },
        select: { moduleId: true }
      });
      if (activePreset === null || activePreset.moduleId !== roomModule.id) {
        redirect("/rooms/" + roomId + "/prepare?error=preset-not-applied");
      }
    }
    await prisma.room.update({
      where: { id: roomId },
      data: { selectedModuleId: roomModule?.id ?? null }
    });
    await applyMagicRulesToRoom(roomId, roomModule?.id ?? null);
    const revision = roomModule === null ? null : await ensureModuleRevision(roomModule.id);
    const game = await prisma.game.create({
      data: {
        roomId,
        moduleId: roomModule?.id ?? null,
        moduleRevisionId: revision === null ? null : revision.id,
        status: "PLAYING",
        title: revision?.title ?? roomModule?.title ?? room.name,
        startedAt: new Date(),
        createdBy: session.user.id
      },
      select: { id: true }
    });
    await prisma.gameState.create({
      data: {
        gameId: game.id,
        moduleId: roomModule?.id ?? null,
        moduleVersion: revision?.version ?? roomModule?.version ?? null,
        paused: false
      }
    });

    for (const player of players) {
      const candidates = approvedByUser.get(player.userId) ?? [];
      const entry =
        player.activeCharacterId === null
          ? candidates[0]
          : candidates.find((item) => item.characterId === player.activeCharacterId) ?? candidates[0];
      if (entry === undefined) continue;
      if (player.activeCharacterId === null) {
        await prisma.roomMember.update({
          where: { id: player.id },
          data: { activeCharacterId: entry.characterId }
        });
      }
      await prisma.gameCharacter.create({
        data: {
          gameId: game.id,
          characterId: entry.characterId,
          userId: player.userId,
          currentHp: entry.character.hp,
          currentMp: entry.character.mp,
          currentSan: entry.character.san,
          currentDp: entry.character.dp
        }
      });
    }
  } else {
    await prisma.game.update({ where: { id: activeGame.id }, data: { status: "PLAYING" } });
    await prisma.gameState.upsert({
      where: { gameId: activeGame.id },
      update: { paused: false },
      create: { gameId: activeGame.id, moduleId: activeGame.moduleId, paused: false }
    });
  }

  await prisma.room.update({ where: { id: roomId }, data: { status: "PLAYING" } });
  emitRoomUpdate(roomId, "PLAYING");
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId);
}

export async function selectRoomModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "").trim();
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId + "/prepare");
  }

  if (moduleId.length > 0) {
    const moduleRecord = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, roomId: true, isPublished: true }
    });
    if (moduleRecord === null || (moduleRecord.roomId !== roomId && moduleRecord.isPublished === false)) {
      redirect("/rooms/" + roomId + "/prepare?error=module");
    }
  }

  await prisma.room.update({
    where: { id: roomId },
    data: { selectedModuleId: moduleId.length > 0 ? moduleId : null }
  });
  const roomState = await prisma.room.findUnique({ where: { id: roomId }, select: { magicEnabled: true } });
  if (roomState?.magicEnabled === true) {
    const applied = await applyMagicRulesToRoom(roomId, moduleId.length > 0 ? moduleId : null);
    if (applied === 0) await prisma.room.update({ where: { id: roomId }, data: { magicEnabled: false } });
  }
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "module");
  redirect("/rooms/" + roomId + "/prepare?module=selected");
}

export async function pauseGameAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);

  const activeGame = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" }
  });
  if (activeGame === null) redirect("/rooms/" + roomId + "/prepare?error=game");

  const activeCombat = await prisma.combat.findFirst({
    where: { roomId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true }
  });
  if (activeCombat !== null && hasCombatRuntime(activeCombat.id)) {
    const runtime = await loadCombatRuntime(activeCombat.id);
    if (runtime !== null) await saveCombatState(activeCombat.id, runtime.state);
  }

  await prisma.game.update({ where: { id: activeGame.id }, data: { status: "PAUSED" } });
  await prisma.gameState.upsert({
    where: { gameId: activeGame.id },
    update: { paused: true },
    create: { gameId: activeGame.id, moduleId: activeGame.moduleId, paused: true }
  });
  await prisma.room.update({ where: { id: roomId }, data: { status: "PAUSED" } });
  await prisma.roomMember.updateMany({
    where: { roomId, role: { not: "SPECTATOR" } },
    data: { ready: false }
  });
  emitRoomUpdate(roomId, "PAUSED");

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/prepare");
}

export async function endGameWithAdvancementsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);

  const parsedRows = parseAdvancementRows(String(formData.get("rows") ?? "[]"));
  if (parsedRows.ok === false) {
    redirect("/rooms/" + roomId + "/end?error=advancement");
  }
  const resolveGrowth = String(formData.get("resolveGrowth") ?? "") === "1";
  const growthSeed = String(formData.get("growthSeed") ?? "").trim().slice(0, 120);

  const activeGame = await prisma.game.findFirst({
    where: {
      id: gameId,
      roomId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    include: { characters: { include: { character: true } } }
  });
  if (activeGame === null) {
    if (parsedRows.rows.length > 0) {
      redirect("/rooms/" + roomId + "/end?error=game");
    }
    const otherActiveGame = await prisma.game.findFirst({
      where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
      select: { id: true }
    });
    if (otherActiveGame !== null) {
      redirect("/rooms/" + roomId + "/end?error=game");
    }

    await prisma.$transaction(async (tx) => {
      await tx.combat.updateMany({
        where: { roomId, endedAt: null },
        data: { phase: "ENDED", endedAt: new Date() }
      });
      await tx.room.update({ where: { id: roomId }, data: { status: "LOBBY" } });
      await tx.roomMember.updateMany({
        where: { roomId, role: { not: "SPECTATOR" } },
        data: { ready: false }
      });
    });

    emitRoomUpdate(roomId, "LOBBY");
    revalidatePath("/rooms/" + roomId);
    revalidatePath("/rooms/" + roomId + "/prepare");
    revalidatePath("/rooms/" + roomId + "/end");
    redirect("/rooms/" + roomId + "/prepare?ended=1");
  }

  const targets: { readonly row: (typeof parsedRows.rows)[number]; readonly gameCharacter: (typeof activeGame.characters)[number] }[] = [];
  for (const row of parsedRows.rows) {
    const gameCharacter = activeGame.characters.find((item) => item.characterId === row.characterId);
    if (gameCharacter === undefined) {
      redirect("/rooms/" + roomId + "/end?error=advancement");
    }
    targets.push({ row, gameCharacter });
  }

  const touchedCharacters = new Set<string>();
  await prisma.$transaction(async (tx) => {
    if (resolveGrowth) {
      const outcome = await resolveGameGrowthChecks(tx, {
        gameId: activeGame.id,
        actorId: session.user.id,
        seed: growthSeed.length === 0 ? null : growthSeed
      });
      for (const result of outcome.results) touchedCharacters.add(result.characterId);
    }
    for (const item of targets) {
      const fresh = await tx.character.findUnique({ where: { id: item.row.characterId } });
      if (fresh === null) continue;
      await applyAdvancement(tx, activeGame.id, item.row.characterId, fresh, item.row, {
        source: "END_REWARD",
        createdBy: session.user.id
      });
      touchedCharacters.add(item.row.characterId);
    }
    await tx.game.update({
      where: { id: activeGame.id },
      data: { status: "ENDED", endedAt: new Date() }
    });
    await tx.gameState.updateMany({
      where: { gameId: activeGame.id },
      data: { paused: false }
    });
    await tx.combat.updateMany({
      where: { roomId, endedAt: null },
      data: { phase: "ENDED", endedAt: new Date() }
    });
    await tx.gameCharacter.updateMany({
      where: { gameId: activeGame.id, currentHp: { gt: 0 } },
      data: { status: "ALIVE" }
    });
    await tx.gameCharacter.updateMany({
      where: { gameId: activeGame.id, currentHp: { lte: 0 } },
      data: { status: "DEAD" }
    });
  });

  await prisma.room.update({ where: { id: roomId }, data: { status: "LOBBY" } });
  await prisma.roomMember.updateMany({
    where: { roomId, role: { not: "SPECTATOR" } },
    data: { ready: false }
  });
  for (const characterId of touchedCharacters) {
    emitAdvancementUpdate(roomId, activeGame.id, characterId);
  }
  emitRoomUpdate(roomId, "LOBBY");

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  revalidatePath("/rooms/" + roomId + "/end");
  for (const characterId of touchedCharacters) {
    revalidatePath("/characters/" + characterId);
  }
  redirect("/rooms/" + roomId + "/prepare?ended=1");
}

export async function disbandRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "").trim();
  if (roomId.length === 0) redirect("/");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, ownerId: true }
  });
  if (room === null) redirect("/");
  if (room.ownerId !== session.user.id) redirect("/?error=disband");

  const modules = await prisma.module.findMany({
    where: { roomId },
    select: { id: true }
  });
  if (modules.length > 0) {
    await prisma.moduleRevision.deleteMany({
      where: { moduleId: { in: modules.map((item) => item.id) } }
    });
  }

  await prisma.room.delete({ where: { id: roomId } });

  revalidatePath("/");
  revalidatePath("/modules");
  revalidatePath("/modules/mine");
  revalidatePath("/history");
  redirect("/?disbanded=1");
}

export async function archiveRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "").trim();
  if (roomId.length === 0) redirect("/");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, ownerId: true, status: true }
  });
  if (room === null) redirect("/");
  if (room.ownerId !== session.user.id) redirect("/?error=archive");
  if (room.status === "ENDED") redirect("/?archived=1");

  const activeGame = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  await prisma.$transaction(async (tx) => {
    if (activeGame !== null) {
      await tx.game.update({
        where: { id: activeGame.id },
        data: { status: "ENDED", endedAt: new Date() }
      });
      await tx.gameState.updateMany({
        where: { gameId: activeGame.id },
        data: { paused: false }
      });
      await tx.gameCharacter.updateMany({
        where: { gameId: activeGame.id, currentHp: { gt: 0 } },
        data: { status: "ALIVE" }
      });
      await tx.gameCharacter.updateMany({
        where: { gameId: activeGame.id, currentHp: { lte: 0 } },
        data: { status: "DEAD" }
      });
    }
    await tx.combat.updateMany({
      where: { roomId, endedAt: null },
      data: { phase: "ENDED", endedAt: new Date() }
    });
    await tx.room.update({ where: { id: roomId }, data: { status: "ENDED" } });
    await tx.roomMember.updateMany({
      where: { roomId, role: { not: "SPECTATOR" } },
      data: { ready: false }
    });
  });

  emitRoomUpdate(roomId, "ENDED");
  revalidatePath("/");
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/?archived=1");
}
