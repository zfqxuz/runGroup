"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { builtinRegistry, resolveRulePack, type CombatMode } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

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
  redirect("/rooms/" + roomId + "/prepare");
}

export async function startRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { members: { select: { role: true, ready: true } } }
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
    await prisma.game.update({ where: { id: activeGame.id }, data: { status: "PLAYING" } });
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
    const requestedModule = requestedModuleId.length === 0
      ? null
      : await prisma.module.findUnique({ where: { id: requestedModuleId } });
    const roomModule = requestedModule !== null && requestedModule.roomId === roomId
      ? requestedModule
      : await prisma.module.findFirst({ where: { roomId }, orderBy: { id: "asc" } });
    const game = await prisma.game.create({
      data: {
        roomId,
        moduleId: roomModule?.id ?? null,
        status: "PLAYING",
        title: roomModule?.title ?? room.name,
        startedAt: new Date(),
        createdBy: session.user.id
      },
      select: { id: true }
    });
    await prisma.gameState.create({
      data: {
        gameId: game.id,
        moduleId: roomModule?.id ?? null,
        moduleVersion: roomModule?.version ?? null,
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
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId);
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

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/prepare");
}

export async function endGameAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);

  const activeGame = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" }
  });
  if (activeGame !== null) {
    await prisma.game.update({
      where: { id: activeGame.id },
      data: { status: "ENDED", endedAt: new Date() }
    });
    await prisma.gameState.updateMany({
      where: { gameId: activeGame.id },
      data: { paused: false }
    });
    await prisma.gameCharacter.updateMany({
      where: { gameId: activeGame.id, currentHp: { gt: 0 } },
      data: { status: "ALIVE" }
    });
    await prisma.gameCharacter.updateMany({
      where: { gameId: activeGame.id, currentHp: { lte: 0 } },
      data: { status: "DEAD" }
    });
  }

  await prisma.room.update({ where: { id: roomId }, data: { status: "LOBBY" } });
  await prisma.roomMember.updateMany({
    where: { roomId, role: { not: "SPECTATOR" } },
    data: { ready: false }
  });

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/prepare");
}
