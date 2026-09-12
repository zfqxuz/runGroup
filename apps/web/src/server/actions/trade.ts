"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function roomUrl(roomId: string, status: string): string {
  return "/rooms/" + roomId + "?trade=" + encodeURIComponent(status) + "#room-members";
}

async function requireMembership(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: {
      role: true,
      activeCharacterId: true,
      room: { select: { status: true } }
    }
  });
}

/** 发起一笔房间内物品交易：把自己当前角色持有的一张卡转给同房间成员。 */
export async function createTradeOfferAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const toUserId = clean(formData.get("toUserId"), 64);
  const cardId = clean(formData.get("cardId"), 64);
  const note = clean(formData.get("note"), 200) || null;
  if (roomId.length === 0 || toUserId.length === 0 || cardId.length === 0) {
    redirect("/rooms/" + roomId);
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null) redirect("/rooms/" + roomId);
  if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
    redirect(roomUrl(roomId, "closed"));
  }
  if (toUserId === session.user.id) redirect(roomUrl(roomId, "self"));

  const target = await requireMembership(roomId, toUserId);
  if (target === null) redirect(roomUrl(roomId, "target"));

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      ownerId: true,
      characterId: true,
      name: true,
      character: { select: { userId: true } }
    }
  });
  if (card === null || card.ownerId !== session.user.id) {
    redirect(roomUrl(roomId, "card"));
  }
  if (card.characterId === null || card.characterId !== membership.activeCharacterId) {
    redirect(roomUrl(roomId, "card"));
  }

  const pending = await prisma.tradeOffer.findFirst({
    where: { cardId: card.id, status: "PENDING" },
    select: { id: true }
  });
  if (pending !== null) redirect(roomUrl(roomId, "pending"));

  await prisma.tradeOffer.create({
    data: { roomId, fromUserId: session.user.id, toUserId, cardId: card.id, note }
  });
  emitRoomRefresh(roomId, "trade-created");
  revalidatePath("/rooms/" + roomId);
  redirect(roomUrl(roomId, "created"));
}

/** 接受 / 拒绝收到的交易，或取消自己发出的交易。 */
export async function respondTradeOfferAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const offerId = clean(formData.get("offerId"), 64);
  const decision = clean(formData.get("decision"), 16);
  if (offerId.length === 0 || ["accept", "reject", "cancel"].includes(decision) === false) {
    redirect("/");
  }

  const offer = await prisma.tradeOffer.findUnique({
    where: { id: offerId },
    include: {
      card: { select: { id: true, ownerId: true, characterId: true, isEquipped: true, equipSlot: true } },
      room: { select: { id: true, status: true } }
    }
  });
  if (offer === null || offer.status !== "PENDING") redirect("/");

  const roomId = offer.roomId;
  if (offer.room.status === "ENDED") redirect(roomUrl(roomId, "closed"));

  if (decision === "cancel") {
    if (offer.fromUserId !== session.user.id) redirect(roomUrl(roomId, "forbidden"));
    await prisma.tradeOffer.update({
      where: { id: offer.id },
      data: { status: "CANCELLED", respondedAt: new Date() }
    });
    emitRoomRefresh(roomId, "trade-cancelled");
    revalidatePath("/rooms/" + roomId);
    redirect(roomUrl(roomId, "cancelled"));
  }

  if (offer.toUserId !== session.user.id) redirect(roomUrl(roomId, "forbidden"));

  if (decision === "reject") {
    await prisma.tradeOffer.update({
      where: { id: offer.id },
      data: { status: "REJECTED", respondedAt: new Date() }
    });
    emitRoomRefresh(roomId, "trade-rejected");
    revalidatePath("/rooms/" + roomId);
    redirect(roomUrl(roomId, "rejected"));
  }

  if (offer.card.ownerId !== offer.fromUserId) {
    await prisma.tradeOffer.update({
      where: { id: offer.id },
      data: { status: "CANCELLED", respondedAt: new Date() }
    });
    emitRoomRefresh(roomId, "trade-cancelled");
    revalidatePath("/rooms/" + roomId);
    redirect(roomUrl(roomId, "missing"));
  }

  const targetMembership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { activeCharacterId: true }
  });
  const targetCharacterId = targetMembership?.activeCharacterId ?? null;

  await prisma.$transaction([
    prisma.card.update({
      where: { id: offer.card.id },
      data: {
        ownerId: session.user.id,
        characterId: targetCharacterId,
        isEquipped: targetCharacterId !== null,
        equipSlot: targetCharacterId === null ? null : (offer.card.equipSlot ?? "MAIN")
      }
    }),
    prisma.tradeOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", respondedAt: new Date() }
    })
  ]);

  emitRoomRefresh(roomId, "trade-accepted");
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/cards");
  revalidatePath("/characters");
  redirect(roomUrl(roomId, "accepted"));
}
