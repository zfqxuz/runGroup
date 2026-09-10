"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ItemStatsSchema, SpellCardStatsSchema, WeaponStatsSchema } from "@/shared/card";

export interface SaveCardInput {
  roomId: string;
  kind: "SPELLCARD" | "WEAPON" | "ITEM";
  name: string;
  subtitle: string | null;
  description: string | null;
  stats: unknown;
}

export interface SaveCardResult {
  ok: boolean;
  error?: string;
  cardId?: string;
}

const inputSchema = z.object({
  roomId: z.string().min(1),
  kind: z.enum(["SPELLCARD", "WEAPON", "ITEM"]),
  name: z.string().min(1).max(40),
  subtitle: z.string().max(40).nullable(),
  description: z.string().max(500).nullable(),
  stats: z.unknown()
});

export async function saveCard(input: SaveCardInput): Promise<SaveCardResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const parsed = inputSchema.safeParse(input);
  if (parsed.success === false) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }
  const data = parsed.data;
  const name = data.name.trim();
  if (name.length === 0) return { ok: false, error: "卡名不能为空" };

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: data.roomId, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) return { ok: false, error: "你不在这个房间里" };

  if (membership.room.system !== "TOUHOU" && data.kind === "SPELLCARD") {
    return { ok: false, error: "本房是 COC7 规则，不支持符卡" };
  }

  const statsResult =
    data.kind === "SPELLCARD"
      ? SpellCardStatsSchema.safeParse(data.stats)
      : data.kind === "WEAPON"
        ? WeaponStatsSchema.safeParse(data.stats)
        : ItemStatsSchema.safeParse(data.stats);

  if (statsResult.success === false) {
    return { ok: false, error: statsResult.error.issues[0]?.message ?? "卡牌数据不合法" };
  }

  const card = await prisma.card.create({
    data: {
      // 卡牌属于用户个人卡库，可跨房间复用
      scope: "COMPENDIUM",
      roomId: null,
      ownerId: session.user.id,
      type: data.kind,
      name,
      subtitle: data.subtitle,
      description: data.description,
      system: membership.room.system,
      stats: statsResult.data as unknown as Prisma.InputJsonValue
    },
    select: { id: true }
  });

  // 带进房间是一条待 KP 审核的申请
  await prisma.roomCardEntry.create({
    data: { roomId: data.roomId, cardId: card.id, status: "PENDING_REVIEW" }
  });

  revalidatePath("/rooms/" + data.roomId);
  return { ok: true, cardId: card.id };
}

/* ---------------- 配发与装备 ---------------- */

async function requireRoomMember(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
}

/**
 * 把房间卡池里的一张卡配发给某个角色。
 * 采用「克隆」语义：卡池模板不动，角色拿到的是独立实例，
 * 之后 KP 改模板不会影响已发出去的卡。
 */
export async function grantCardAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  const characterId = String(formData.get("characterId") ?? "");
  if (cardId.length === 0 || characterId.length === 0) return;

  const source = await prisma.card.findUnique({ where: { id: cardId } });
  if (source === null || source.roomId === null) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (character === null || character.roomId !== source.roomId) return;

  const membership = await requireRoomMember(source.roomId, session.user.id);
  if (membership === null) return;

  const isOwner = character.userId === session.user.id;
  const isKP = membership.role === "KP";
  if (isOwner === false && isKP === false) return;

  const already = await prisma.card.findFirst({
    where: { templateId: source.id, characterId }
  });
  if (already !== null) return;

  await prisma.card.create({
    data: {
      scope: "CHARACTER",
      templateId: source.id,
      roomId: source.roomId,
      ownerId: character.userId,
      characterId,
      type: source.type,
      name: source.name,
      subtitle: source.subtitle,
      description: source.description,
      rarity: source.rarity,
      system: source.system,
      stats: source.stats as Prisma.InputJsonValue,
      isEquipped: false,
      quantity: 1
    }
  });

  revalidatePath("/rooms/" + source.roomId);
  revalidatePath("/rooms/" + source.roomId + "/characters/" + characterId);
}

/** 装备/卸下。装备槽位暂时只有一个，后续可扩展到多槽。 */
export async function toggleEquipAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  if (cardId.length === 0) return;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null || card.characterId === null || card.roomId === null) return;

  const character = await prisma.character.findUnique({ where: { id: card.characterId } });
  if (character === null) return;

  const membership = await requireRoomMember(card.roomId, session.user.id);
  if (membership === null) return;

  const allowed = character.userId === session.user.id || membership.role === "KP";
  if (allowed === false) return;

  await prisma.card.update({
    where: { id: card.id },
    data: { isEquipped: card.isEquipped === false, equipSlot: card.isEquipped ? null : "MAIN" }
  });

  revalidatePath("/rooms/" + card.roomId + "/characters/" + character.id);
}

/** 删除一张卡（仅本人的角色卡或 KP）。 */
export async function deleteCardAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  if (cardId.length === 0) return;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null) return;

  if (card.roomId !== null) {
    const membership = await requireRoomMember(card.roomId, session.user.id);
    if (membership === null) return;
    if (membership.role !== "KP" && card.ownerId !== session.user.id) return;
  } else if (card.ownerId !== session.user.id) {
    return;
  }

  await prisma.card.delete({ where: { id: card.id } });
  if (card.roomId !== null) revalidatePath("/rooms/" + card.roomId);
}
