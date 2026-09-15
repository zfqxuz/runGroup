"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveBgmLink } from "@/server/bgm/resolve";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { isActiveGameStatus } from "@/server/game/view";
import { emitRoomBgmUpdate } from "@/server/realtime";
import { bgmToCustomRecord, type RoomBgmView } from "@/shared/bgm";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeReturnTo(roomId: string, raw: FormDataEntryValue | null, fallback: string): string {
  const value = clean(raw, 300);
  if (value.startsWith("/rooms/" + roomId) && value.startsWith("//") === false) return value;
  return fallback;
}

async function requireKp(roomId: string, userId: string): Promise<boolean> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP";
}

/**
 * KP 设置 / 切换 / 停止房间 BGM。
 * link 为空表示停止播放；状态写入 GameState.custom.bgm 并通过 Socket 广播给全房间。
 */
export async function setRoomBgmAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const gameId = clean(formData.get("gameId"), 64);
  const rawLink = clean(formData.get("link"), 1200);
  const returnTo = safeReturnTo(
    roomId,
    formData.get("returnTo"),
    "/rooms/" + roomId + (rawLink.length === 0 ? "?bgm=cleared#kp-bgm" : "?bgm=saved#kp-bgm")
  );
  if (roomId.length === 0 || gameId.length === 0) redirect("/rooms/" + roomId);

  if ((await requireKp(roomId, session.user.id)) === false) {
    redirect("/rooms/" + roomId);
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { roomId: true, status: true }
  });
  if (game === null || game.roomId !== roomId || isActiveGameStatus(game.status) === false) {
    redirect("/rooms/" + roomId + "?bgm=game#kp-bgm");
  }

  let bgm: RoomBgmView | null = null;
  if (rawLink.length > 0) {
    const resolved = await resolveBgmLink(rawLink);
    if (resolved.ok === false) {
      redirect("/rooms/" + roomId + "?bgm=invalid#kp-bgm");
    }
    bgm = resolved.value;
  }

  const existing = await prisma.gameState.findUnique({
    where: { gameId },
    select: { custom: true }
  });
  const custom = { ...recordOf(existing?.custom) };
  if (bgm === null) {
    delete custom.bgm;
  } else {
    custom.bgm = bgmToCustomRecord(bgm);
  }

  if (existing === null) {
    await prisma.gameState.create({
      data: { gameId, custom: custom as never }
    });
  } else {
    await prisma.gameState.update({
      where: { gameId },
      data: { custom: custom as never, version: { increment: 1 } }
    });
  }

  emitRoomBgmUpdate(roomId, bgm);
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect(returnTo);
}
