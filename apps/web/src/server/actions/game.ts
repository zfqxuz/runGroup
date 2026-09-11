"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { applyAdvancement, validateAdvancement } from "@/server/game/advancement";
import { isActiveGameStatus, gameStateView } from "@/server/game/view";
import { getSocketServer } from "@/server/socket/io";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalClean(value: FormDataEntryValue | null, maxLength: number): string | null {
  const text = clean(value, maxLength);
  return text.length === 0 ? null : text;
}

function integerOf(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (text.length === 0) return null;
  const number = Number(text);
  if (Number.isFinite(number) === false) return null;
  if (Math.floor(number) !== number) return null;
  return number;
}

function objectOf(value: FormDataEntryValue | null, label: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const text = clean(value, 30000);
  if (text.length === 0) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: label + "必须是 JSON 对象" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: label + "不是合法 JSON" };
  }
}

async function requireKP(roomId: string, userId: string): Promise<boolean> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP";
}

export async function updateGameStateAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const gameId = clean(formData.get("gameId"), 64);
  if (roomId.length === 0 || gameId.length === 0) redirect("/");

  if ((await requireKP(roomId, session.user.id)) === false) {
    redirect("/rooms/" + roomId);
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (game === null || game.roomId !== roomId || isActiveGameStatus(game.status) === false) {
    redirect("/rooms/" + roomId + "?error=game");
  }

  const flags = objectOf(formData.get("flags"), "旗标");
  if (flags.ok === false) redirect("/rooms/" + roomId + "?error=flags");
  const counters = objectOf(formData.get("counters"), "计数器");
  if (counters.ok === false) redirect("/rooms/" + roomId + "?error=counters");
  const custom = objectOf(formData.get("custom"), "自定义状态");
  if (custom.ok === false) redirect("/rooms/" + roomId + "?error=custom");

  const expectedVersion = integerOf(formData.get("expectedVersion"));
  const existing = await prisma.gameState.findUnique({ where: { gameId } });
  if (existing !== null && expectedVersion !== null && existing.version !== expectedVersion) {
    redirect("/rooms/" + roomId + "?error=version");
  }

  const data = {
    moduleId: game.moduleId,
    currentChapterId: optionalClean(formData.get("currentChapterId"), 200),
    currentSceneId: optionalClean(formData.get("currentSceneId"), 200),
    currentEncounterId: optionalClean(formData.get("currentEncounterId"), 200),
    gameTime: optionalClean(formData.get("gameTime"), 120),
    flags: flags.value as never,
    counters: counters.value as never,
    custom: custom.value as never
  };

  if (existing === null) {
    await prisma.gameState.create({
      data: { gameId, moduleVersion: null, ...data }
    });
  } else {
    const result = await prisma.gameState.updateMany({
      where: { gameId, version: existing.version },
      data: { ...data, version: { increment: 1 } }
    });
    if (result.count === 0) redirect("/rooms/" + roomId + "?error=version");
  }

  const updated = await prisma.gameState.findUnique({ where: { gameId } });
  if (updated !== null) {
    getSocketServer()?.to("room:" + roomId).emit("room:state:update", {
      roomId,
      gameId,
      state: gameStateView(updated)
    });
  }

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "?state=saved");
}

export async function recordAdvancementAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const gameId = clean(formData.get("gameId"), 64);
  const characterId = clean(formData.get("characterId"), 64);
  const kindRaw = clean(formData.get("kind"), 40);
  const target = optionalClean(formData.get("target"), 120);
  const delta = integerOf(formData.get("delta"));
  const note = optionalClean(formData.get("note"), 1000);
  if (roomId.length === 0 || gameId.length === 0 || characterId.length === 0) {
    redirect("/rooms/" + roomId + "?error=advancement");
  }

  if ((await requireKP(roomId, session.user.id)) === false) {
    redirect("/rooms/" + roomId);
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (game === null || game.roomId !== roomId || isActiveGameStatus(game.status) === false) {
    redirect("/rooms/" + roomId + "?error=game");
  }

  const gameCharacter = await prisma.gameCharacter.findUnique({
    where: { gameId_characterId: { gameId, characterId } },
    include: { character: true }
  });
  if (gameCharacter === null || gameCharacter.userId !== gameCharacter.character.userId) {
    redirect("/rooms/" + roomId + "?error=advancement");
  }

  const validation = validateAdvancement(kindRaw, target, delta, note);
  if (validation.ok === false) {
    redirect("/rooms/" + roomId + "?error=advancement");
  }

  await prisma.$transaction(async (tx) => {
    await applyAdvancement(
      tx,
      gameId,
      characterId,
      gameCharacter.character as unknown as Record<string, unknown>,
      validation.value
    );
  });

  getSocketServer()?.to("room:" + roomId).emit("room:advancement:update", {
    roomId,
    gameId,
    characterId
  });

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  revalidatePath("/characters/" + characterId);
  redirect("/rooms/" + roomId + "?advancement=saved");
}
