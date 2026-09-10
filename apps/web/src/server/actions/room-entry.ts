"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

async function membershipOf(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
}

/** 把自己库里的一张角色卡带进房间，等待 KP 审核。 */
export async function submitCharacterToRoom(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const roomId = String(formData.get("roomId") ?? "");
  const characterId = String(formData.get("characterId") ?? "");
  if (roomId.length === 0 || characterId.length === 0) return;

  const membership = await membershipOf(roomId, session.user.id);
  if (membership === null) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (character === null || character.userId !== session.user.id) return;

  const roomForCharacter = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true }
  });
  if (roomForCharacter === null) return;
  // 模组不混用：东方角色进不了 COC7 房间，反之亦然
  if (character.system !== roomForCharacter.system) return;

  await prisma.roomCharacterEntry.upsert({
    where: { roomId_characterId: { roomId, characterId } },
    create: { roomId, characterId, status: "PENDING_REVIEW" },
    update: { status: "PENDING_REVIEW", comment: null, submittedAt: new Date(), reviewedAt: null }
  });

  revalidatePath("/rooms/" + roomId);
}

/** 把自己库里的一张卡带进房间，等待 KP 审核。 */
export async function submitCardToRoom(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const roomId = String(formData.get("roomId") ?? "");
  const cardId = String(formData.get("cardId") ?? "");
  if (roomId.length === 0 || cardId.length === 0) return;

  const membership = await membershipOf(roomId, session.user.id);
  if (membership === null) return;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null || card.ownerId !== session.user.id) return;

  const roomForCard = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true }
  });
  if (roomForCard === null) return;
  // 模组不混用：COC7 的卡带不进东方房
  if (card.system !== roomForCard.system) return;

  await prisma.roomCardEntry.upsert({
    where: { roomId_cardId: { roomId, cardId } },
    create: { roomId, cardId, status: "PENDING_REVIEW" },
    update: { status: "PENDING_REVIEW", comment: null, submittedAt: new Date(), reviewedAt: null }
  });

  revalidatePath("/rooms/" + roomId);
}

/** 撤回自己的申请。 */
export async function withdrawEntry(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const kind = String(formData.get("kind") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  if (entryId.length === 0) return;

  if (kind === "CHARACTER") {
    const entry = await prisma.roomCharacterEntry.findUnique({
      where: { id: entryId },
      include: { character: { select: { userId: true } } }
    });
    if (entry === null || entry.character.userId !== session.user.id) return;
    await prisma.roomCharacterEntry.delete({ where: { id: entry.id } });
    revalidatePath("/rooms/" + entry.roomId);
    return;
  }

  const entry = await prisma.roomCardEntry.findUnique({
    where: { id: entryId },
    include: { card: { select: { ownerId: true } } }
  });
  if (entry === null || entry.card.ownerId !== session.user.id) return;
  await prisma.roomCardEntry.delete({ where: { id: entry.id } });
  revalidatePath("/rooms/" + entry.roomId);
}

/** KP 审核。approve=1 通过，否则驳回。 */
export async function reviewEntry(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const kind = String(formData.get("kind") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const approved = String(formData.get("approve") ?? "") === "1";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 200);
  if (entryId.length === 0) return;

  const status = approved ? "APPROVED" : "REJECTED";
  const reviewedAt = new Date();

  if (kind === "CHARACTER") {
    const entry = await prisma.roomCharacterEntry.findUnique({ where: { id: entryId } });
    if (entry === null) return;
    const membership = await membershipOf(entry.roomId, session.user.id);
    if (membership === null || membership.role !== "KP") return;
    await prisma.roomCharacterEntry.update({
      where: { id: entry.id },
      data: { status, comment: comment.length === 0 ? null : comment, reviewedAt }
    });
    revalidatePath("/rooms/" + entry.roomId);
    return;
  }

  const entry = await prisma.roomCardEntry.findUnique({ where: { id: entryId } });
  if (entry === null) return;
  const membership = await membershipOf(entry.roomId, session.user.id);
  if (membership === null || membership.role !== "KP") return;
  await prisma.roomCardEntry.update({
    where: { id: entry.id },
    data: { status, comment: comment.length === 0 ? null : comment, reviewedAt }
  });
  revalidatePath("/rooms/" + entry.roomId);
}

/** KP 批量审核卡牌带入申请。 */
export async function reviewCardEntries(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const ids = formData
    .getAll("entryIds")
    .map((value) => String(value))
    .filter((value) => value.length > 0)
    .slice(0, 200);
  if (ids.length === 0) return;

  const approved = String(formData.get("decision") ?? "REJECT") === "APPROVE";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 200);
  const status = approved ? "APPROVED" : "REJECTED";
  const reviewedAt = new Date();

  const entries = await prisma.roomCardEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true, roomId: true }
  });
  const first = entries[0];
  if (first === undefined) return;
  const roomId = first.roomId;
  const sameRoom = entries.every((entry) => entry.roomId === roomId);
  if (sameRoom === false) return;

  const membership = await membershipOf(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") return;

  await prisma.roomCardEntry.updateMany({
    where: {
      id: { in: entries.map((entry) => entry.id) },
      roomId,
      status: "PENDING_REVIEW"
    },
    data: { status, comment: comment.length === 0 ? null : comment, reviewedAt }
  });

  revalidatePath("/rooms/" + roomId);
}
