"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ItemStatsSchema, SpellCardStatsSchema, WeaponStatsSchema } from "@/shared/card";

export interface SaveCardInput {
  roomId: string | null;
  system: string;
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
  roomId: z.string().min(1).nullable(),
  system: z.enum(["COC7", "TOUHOU"]),
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

  const room =
    data.roomId === null ? null : await prisma.room.findUnique({ where: { id: data.roomId } });
  if (data.roomId !== null && room === null) return { ok: false, error: "房间不存在" };

  if (room !== null) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: session.user.id } }
    });
    if (membership === null) return { ok: false, error: "你不在这个房间里" };
  }

  const system = room?.system ?? data.system;
  if (system !== "TOUHOU" && data.kind === "SPELLCARD") {
    return { ok: false, error: "COC7 规则下不支持符卡" };
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
      system,
      stats: statsResult.data as unknown as Prisma.InputJsonValue
    },
    select: { id: true }
  });

  // 带进房间是一条待 KP 审核的申请
  if (room !== null) {
    await prisma.roomCardEntry.create({
      data: { roomId: room.id, cardId: card.id, status: "PENDING_REVIEW" }
    });
    revalidatePath("/rooms/" + room.id);
  }
  revalidatePath("/cards");
  return { ok: true, cardId: card.id };
}

/* ---------------- 配发与装备 ---------------- */

async function requireRoomMember(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
}

/** 把库里的一张卡装备给某个角色（卡从库中移入该角色）。 */
export async function equipCardAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  const characterId = String(formData.get("characterId") ?? "");
  if (cardId.length === 0 || characterId.length === 0) return;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (card === null || character === null) return;
  if (card.ownerId !== session.user.id || character.userId !== session.user.id) return;

  await prisma.card.update({
    where: { id: card.id },
    data: { characterId, isEquipped: true, equipSlot: "MAIN" }
  });

  revalidatePath("/cards");
  revalidatePath("/characters/" + characterId);
}

/** 卸下，卡回到用户库里。 */
export async function unequipCardAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  if (cardId.length === 0) return;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null || card.ownerId !== session.user.id) return;

  const characterId = card.characterId;

  await prisma.card.update({
    where: { id: card.id },
    data: { characterId: null, isEquipped: false, equipSlot: null }
  });

  revalidatePath("/cards");
  if (characterId !== null) revalidatePath("/characters/" + characterId);
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

/** 把自己的 COMPENDIUM 卡设置为共享模板，供其他用户复制。 */
export async function setCardTemplateAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const cardId = String(formData.get("cardId") ?? "");
  if (cardId.length === 0) return;
  const shared = String(formData.get("shared") ?? "") === "1";

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null || card.ownerId !== session.user.id || card.scope !== "COMPENDIUM") return;

  await prisma.card.update({ where: { id: card.id }, data: { isTemplate: shared } });
  revalidatePath("/cards");
}

/** 复制一张共享模板到自己的卡库；同一模板只保留一份副本。 */
export async function copyCardTemplateAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;

  const templateId = String(formData.get("templateId") ?? "");
  if (templateId.length === 0) return;

  const source = await prisma.card.findUnique({ where: { id: templateId } });
  if (source === null || source.scope !== "COMPENDIUM" || source.isTemplate === false) return;
  if (source.ownerId === session.user.id) return;

  const existing = await prisma.card.findFirst({
    where: { templateId: source.id, ownerId: session.user.id },
    select: { id: true }
  });
  if (existing !== null) {
    revalidatePath("/cards");
    return;
  }

  await prisma.card.create({
    data: {
      scope: "COMPENDIUM",
      templateId: source.id,
      ownerId: session.user.id,
      type: source.type,
      name: source.name,
      subtitle: source.subtitle,
      description: source.description,
      imageUrl: source.imageUrl,
      thumbnailUrl: source.thumbnailUrl,
      rarity: source.rarity,
      frameColor: source.frameColor,
      stats: source.stats as Prisma.InputJsonValue,
      system: source.system,
      isEquipped: false,
      equipSlot: null,
      quantity: source.quantity,
      pointCost: source.pointCost
    }
  });

  revalidatePath("/cards");
}
