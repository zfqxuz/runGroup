"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function requireMembership(roomId: string, userId: string): Promise<{ role: string; status: string } | null> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, room: { select: { status: true } } }
  });
  if (membership === null) return null;
  return { role: membership.role, status: membership.room.status };
}

function revalidateRoom(roomId: string): void {
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "room-info");
}

export async function createClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const title = clean(formData.get("title"), 120);
  const content = clean(formData.get("content"), 5000);
  const isPublic = String(formData.get("isPublic") ?? "0") === "1";
  if (roomId.length === 0 || title.length === 0 || content.length === 0) {
    redirect("/rooms/" + roomId + "?clue=invalid");
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId);
  }

  await prisma.clue.create({
    data: { roomId, title, content, isPublic }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?clue=created#room-info");
}

export async function discoverClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || clueId.length === 0) {
    redirect("/rooms/" + roomId);
  }

  const clue = await prisma.clue.findUnique({
    where: { id: clueId },
    select: { id: true, roomId: true }
  });
  if (clue === null || clue.roomId !== roomId) {
    redirect("/rooms/" + roomId);
  }

  await prisma.clueDiscovery.upsert({
    where: { clueId_userId: { clueId, userId: session.user.id } },
    update: {},
    create: { clueId, userId: session.user.id }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?clue=discovered#room-info");
}

export async function createNoteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const title = clean(formData.get("title"), 120);
  const content = clean(formData.get("content"), 5000);
  const requestedKpOnly = String(formData.get("isKPOnly") ?? "0") === "1";
  if (roomId.length === 0 || title.length === 0 || content.length === 0) {
    redirect("/rooms/" + roomId + "?note=invalid");
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null) redirect("/rooms/" + roomId);
  const isKPOnly = requestedKpOnly && membership.role === "KP";

  await prisma.note.create({
    data: {
      roomId,
      userId: session.user.id,
      title,
      content,
      isKPOnly
    }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?note=created#room-info");
}

function safeClueReturnTo(roomId: string, raw: FormDataEntryValue | null, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("/rooms/" + roomId) && value.startsWith("//") === false) return value;
  return fallback;
}

async function requireKpAndClue(roomId: string, clueId: string, userId: string) {
  const membership = await requireMembership(roomId, userId);
  if (membership === null || membership.role !== "KP") return null;
  const clue = await prisma.clue.findUnique({ where: { id: clueId }, select: { id: true, roomId: true } });
  if (clue === null || clue.roomId !== roomId) return null;
  return clue;
}

/** KP 编辑线索标题 / 正文 / 公开状态。 */
export async function updateClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const title = clean(formData.get("title"), 120);
  const content = clean(formData.get("content"), 20000);
  const isPublic = String(formData.get("isPublic") ?? "0") === "1";
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=updated#room-info");
  if (roomId.length === 0 || clueId.length === 0 || title.length === 0 || content.length === 0) {
    redirect(returnTo);
  }
  const clue = await requireKpAndClue(roomId, clueId, session.user.id);
  if (clue === null) redirect("/rooms/" + roomId);
  await prisma.clue.update({
    where: { id: clue.id },
    data: { title, content, isPublic }
  });
  revalidateRoom(roomId);
  redirect(returnTo);
}

/** KP 一键公开 / 隐藏线索。 */
export async function setClueVisibilityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const isPublic = String(formData.get("isPublic") ?? "0") === "1";
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=published#room-info");
  const clue = await requireKpAndClue(roomId, clueId, session.user.id);
  if (clue === null) redirect("/rooms/" + roomId);
  await prisma.clue.update({ where: { id: clue.id }, data: { isPublic } });
  revalidateRoom(roomId);
  redirect(returnTo);
}

/** KP 删除线索及其分享 / 发现记录。 */
export async function deleteClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=deleted#room-info");
  const clue = await requireKpAndClue(roomId, clueId, session.user.id);
  if (clue === null) redirect("/rooms/" + roomId);
  await prisma.clue.delete({ where: { id: clue.id } });
  revalidateRoom(roomId);
  redirect(returnTo);
}

/**
 * KP 把线索定向发给指定成员。
 * 用本次提交的 targetUserIds 整体替换分享名单；传空数组表示取消全部定向分享。
 */
export async function shareClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=shared#room-info");
  const clue = await requireKpAndClue(roomId, clueId, session.user.id);
  if (clue === null) redirect("/rooms/" + roomId);

  const requested = formData
    .getAll("targetUserIds")
    .map((value) => String(value))
    .filter((value) => value.length > 0)
    .slice(0, 100);
  const members = requested.length === 0
    ? []
    : await prisma.roomMember.findMany({
        where: { roomId, userId: { in: requested }, role: { not: "KP" } },
        select: { userId: true }
      });
  const targetIds = members.map((member) => member.userId);

  await prisma.$transaction(async (tx) => {
    await tx.clueShare.deleteMany({ where: { clueId: clue.id } });
    if (targetIds.length > 0) {
      await tx.clueShare.createMany({
        data: targetIds.map((userId) => ({ clueId: clue.id, userId, sharedBy: session.user.id }))
      });
    }
  });

  revalidateRoom(roomId);
  redirect(returnTo);
}
