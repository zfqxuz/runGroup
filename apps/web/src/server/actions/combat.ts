"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCombatRecord, listSelectableUnits } from "@/server/combat/setup";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";

function errorUrl(roomId: string, path: string, message: string): string {
  return "/rooms/" + roomId + path + "?error=" + encodeURIComponent(message);
}

async function requireRoomMember(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: { room: true }
  });
}

export async function startCombatAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await requireRoomMember(roomId, session.user.id);
  if (membership === null) redirect("/");
  const room = membership.room;
  if (room.status === "LOBBY") {
    redirect("/rooms/" + room.id + "/prepare");
  }
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const allies = formData.getAll("allies").map((value) => String(value));
  const enemies = formData.getAll("enemies").map((value) => String(value));

  if (membership.role === "KP") {
    const result = await createCombatRecord(room.id, effective, allies, enemies);
    if (result.ok === false || result.combatId === undefined) {
      redirect(errorUrl(room.id, "/combat/new", result.error ?? "战斗创建失败"));
    }
    revalidatePath("/rooms/" + room.id);
    redirect("/rooms/" + room.id);
  }

  if (room.allowPlayerCombatRequest === false) {
    redirect(errorUrl(room.id, "/combat/new", "本房间当前不允许玩家发起战斗申请"));
  }
  const selectable = await listSelectableUnits(room.id, session.user.id, "PLAYER");
  const controllable = new Set(selectable.filter((unit) => unit.kind === "CHARACTER").map((unit) => unit.ref));
  const requested = allies.filter((ref) => controllable.has(ref));
  if (requested.length === 0) {
    redirect(errorUrl(room.id, "/combat/new", "请至少选择一个你能操控的角色"));
  }
  await prisma.combatRequest.create({
    data: {
      roomId: room.id,
      initiatorId: session.user.id,
      status: "PENDING_REVIEW",
      setup: { allies: requested, enemies: [] } as never
    }
  });
  revalidatePath("/rooms/" + room.id);
  redirect("/rooms/" + room.id + "?combatRequest=submitted");
}

export async function reviewCombatRequestAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  const approve = String(formData.get("approve") ?? "0") === "1";
  const membership = await requireRoomMember(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") redirect("/");
  if (membership === null) redirect("/");
  const request = await prisma.combatRequest.findUnique({
    where: { id: requestId },
    include: { room: true }
  });
  if (request === null || request.roomId !== roomId) redirect("/rooms/" + roomId);
  if (request.status !== "PENDING_REVIEW") redirect("/rooms/" + roomId);

  if (approve === false) {
    await prisma.combatRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", reviewedAt: new Date() }
    });
    revalidatePath("/rooms/" + roomId);
    redirect("/rooms/" + roomId);
  }

  const effective = await loadEffectivePack({
    id: request.room.id,
    system: request.room.system,
    rulePackVersionId: request.room.rulePackVersionId,
    ruleOverride: request.room.ruleOverride
  });
  const setup = (request.setup ?? {}) as { allies?: unknown; enemies?: unknown };
  const allies = Array.isArray(setup.allies) ? setup.allies.map((value) => String(value)) : [];
  const enemies = formData.getAll("enemies").map((value) => String(value));
  const result = await createCombatRecord(request.roomId, effective, allies, enemies);
  if (result.ok === false || result.combatId === undefined) {
    redirect(errorUrl(roomId, "/combat/requests/" + request.id, result.error ?? "战斗创建失败"));
  }
  await prisma.combatRequest.update({
    where: { id: request.id },
    data: { status: "APPROVED", reviewedAt: new Date() }
  });
  revalidatePath("/rooms/" + roomId);
  redirect("/rooms/" + roomId);
}
