"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { MAX_UPLOAD_BYTES, publicPath, storeImage, type StoredImage } from "@/server/assets/storage";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function fileOf(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

/** 线索图片统一走 Asset，类型沿用 HANDOUT；Asset.clues 已与 Clue.assetId 关联。 */
async function createClueImage(input: {
  readonly ownerId: string;
  readonly roomId: string;
  readonly file: File;
}): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }> {
  if (input.file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "图片超过 " + Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024) + " MB" };
  }

  let stored: StoredImage;
  try {
    stored = await storeImage(Buffer.from(await input.file.arrayBuffer()), { category: "clues" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "图片处理失败" };
  }

  const asset = await prisma.asset.create({
    data: {
      ownerId: input.ownerId,
      roomId: input.roomId,
      type: "HANDOUT",
      filename: stored.filename,
      originalName: input.file.name.slice(0, 120),
      mimeType: stored.mime,
      size: stored.size,
      width: stored.width,
      height: stored.height,
      url: publicPath("clues", stored.filename),
      thumbnailUrl: publicPath("clues", stored.thumbnailName),
      checksum: stored.checksum
    },
    select: { id: true }
  });
  return { ok: true, id: asset.id };
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
  const imageFile = fileOf(formData.get("image"));
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=created#room-info");
  if (roomId.length === 0 || title.length === 0 || (content.length === 0 && imageFile === null)) {
    redirect("/rooms/" + roomId + "?clue=invalid");
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId);
  }

  let assetId: string | null = null;
  if (imageFile !== null) {
    const uploaded = await createClueImage({ ownerId: session.user.id, roomId, file: imageFile });
    if (uploaded.ok === false) {
      redirect("/rooms/" + roomId + "?clue=image");
    }
    assetId = uploaded.id;
  }

  try {
    await prisma.clue.create({
      data: { roomId, title, content, isPublic, assetId }
    });
  } catch {
    if (assetId !== null) await deleteAssetIfOrphan(assetId).catch(() => undefined);
    redirect("/rooms/" + roomId + "?clue=invalid");
  }

  revalidateRoom(roomId);
  redirect(returnTo);
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
  const clue = await prisma.clue.findUnique({
    where: { id: clueId },
    select: { id: true, roomId: true, assetId: true }
  });
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
  const imageFile = fileOf(formData.get("image"));
  const removeImage = String(formData.get("removeImage") ?? "0") === "1";
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=updated#room-info");
  if (roomId.length === 0 || clueId.length === 0 || title.length === 0) {
    redirect(returnTo);
  }
  const clue = await requireKpAndClue(roomId, clueId, session.user.id);
  if (clue === null) redirect("/rooms/" + roomId);

  if (content.length === 0 && imageFile === null && (clue.assetId === null || removeImage)) {
    redirect(returnTo);
  }

  let nextAssetId = clue.assetId;
  if (imageFile !== null) {
    const uploaded = await createClueImage({ ownerId: session.user.id, roomId, file: imageFile });
    if (uploaded.ok === false) redirect(returnTo);
    nextAssetId = uploaded.id;
  } else if (removeImage) {
    nextAssetId = null;
  }

  await prisma.clue.update({
    where: { id: clue.id },
    data: { title, content, isPublic, assetId: nextAssetId }
  });
  if (clue.assetId !== null && clue.assetId !== nextAssetId) {
    await deleteAssetIfOrphan(clue.assetId).catch(() => undefined);
  }
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
  if (clue.assetId !== null) {
    await deleteAssetIfOrphan(clue.assetId).catch(() => undefined);
  }
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

/**
 * 玩家把一条自己已知的线索定向分享给同房间的其他成员。
 * 分享人必须能看到该线索：KP 可分享任意线索；玩家只能分享公开 / 自己发现 / 别人分享给自己的线索。
 */
export async function shareClueWithMemberAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const targetUserId = clean(formData.get("targetUserId"), 64);
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=shared#room-info");
  if (roomId.length === 0 || clueId.length === 0 || targetUserId.length === 0 || targetUserId === session.user.id) {
    redirect("/rooms/" + roomId);
  }

  const [membership, target] = await Promise.all([
    requireMembership(roomId, session.user.id),
    requireMembership(roomId, targetUserId)
  ]);
  if (membership === null || target === null) redirect("/rooms/" + roomId);

  const clue = await prisma.clue.findUnique({
    where: { id: clueId },
    select: {
      id: true,
      roomId: true,
      isPublic: true,
      discoveredBy: { where: { userId: session.user.id }, select: { userId: true } },
      shares: { where: { userId: session.user.id }, select: { userId: true } }
    }
  });
  if (clue === null || clue.roomId !== roomId) redirect(returnTo);
  const known = membership.role === "KP" || clue.isPublic || clue.discoveredBy.length > 0 || clue.shares.length > 0;
  if (known === false) redirect(returnTo);

  await prisma.clueShare.upsert({
    where: { clueId_userId: { clueId: clue.id, userId: targetUserId } },
    update: {},
    create: { clueId: clue.id, userId: targetUserId, sharedBy: session.user.id }
  });
  revalidateRoom(roomId);
  redirect(returnTo);
}
/** KP 一键把本房间所有公开线索改为仅 KP 可见。 */
export async function setAllCluesPrivateAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const returnTo = safeClueReturnTo(roomId, formData.get("returnTo"), "/rooms/" + roomId + "?clue=updated#room-info");
  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);
  await prisma.clue.updateMany({ where: { roomId, isPublic: true }, data: { isPublic: false } });
  revalidateRoom(roomId);
  redirect(returnTo);
}
