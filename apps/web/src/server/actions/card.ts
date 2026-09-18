"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";
import {
  CARD_KIND_LABELS,
  ItemStatsSchema,
  SpellCardStatsSchema,
  WeaponStatsSchema,
  disallowedEffectTypesForKind,
  type CardKind
} from "@/shared/card";
import { convertCardStats } from "@/server/card/equipment";

export interface SaveCardInput {
  /** 传入表示编辑已有卡；不传表示新建。 */
  cardId?: string;
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
  cardId: z.string().min(1).optional(),
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
  const disallowed = disallowedEffectTypesForKind(data.kind as CardKind, statsResult.data.effects);
  if (disallowed.length > 0) {
    return {
      ok: false,
      error: CARD_KIND_LABELS[data.kind as CardKind] + "不能使用效果：" + disallowed.join("、")
    };
  }

  // 编辑已有卡：仅限本人，直接覆盖内容，不重复建卡。
  if (data.cardId !== undefined) {
    const existing = await prisma.card.findUnique({ where: { id: data.cardId }, select: { ownerId: true } });
    if (existing === null || existing.ownerId !== session.user.id) {
      return { ok: false, error: "只能编辑自己的卡" };
    }
    await prisma.card.update({
      where: { id: data.cardId },
      data: {
        type: data.kind,
        name,
        subtitle: data.subtitle,
        description: data.description,
        system,
        stats: statsResult.data as unknown as Prisma.InputJsonValue
      }
    });
    revalidatePath("/cards");
    revalidatePath("/cards/" + data.cardId);
    return { ok: true, cardId: data.cardId };
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
  // 物品卡是唯一的：已经装备给某个角色的卡不能直接改绑到另一个角色，必须先卸下。
  if (card.characterId !== null && card.characterId !== characterId) return;

  await prisma.card.update({
    where: { id: card.id },
    data: { characterId, isEquipped: true, equipSlot: "MAIN" }
  });
  revalidatePath("/cards");
  revalidatePath("/characters/" + characterId);
}

function cardStatsRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? { ...(value as Record<string, unknown>) }
    : {};
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
  if (card.roomId !== null) {
    revalidatePath("/rooms/" + card.roomId);
    emitRoomRefresh(card.roomId, "card-deleted");
  }
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

function safeCardReturnTo(roomId: string, raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("/rooms/" + roomId) && value.startsWith("//") === false) return value;
  return "/rooms/" + roomId;
}

/** KP 编辑房间预设物化出来的物品 / 证物 / 线索卡。 */
export async function updateRoomCardAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const cardId = String(formData.get("cardId") ?? "");
  if (cardId.length === 0) redirect("/");

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, roomId: true, scope: true, type: true, stats: true }
  });
  if (card === null || card.roomId === null || card.scope !== "ROOM") redirect("/");
  const roomId = card.roomId;
  const returnTo = safeCardReturnTo(roomId, formData.get("returnTo"));
  const membership = await requireRoomMember(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length === 0) redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "error=card-name");
  const statsText = String(formData.get("stats") ?? "").trim();
  let stats: Record<string, unknown> = {};
  if (statsText.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(statsText);
    } catch {
      redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "error=card-stats");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "error=card-stats");
    }
    stats = parsed as Record<string, unknown>;
  }

  const rarityRaw = String(formData.get("rarity") ?? "COMMON");
  const quantity = Number(String(formData.get("quantity") ?? "1"));
  await prisma.card.update({
    where: { id: card.id },
    data: {
      name,
      subtitle: String(formData.get("subtitle") ?? "").trim().slice(0, 80) || null,
      description: String(formData.get("description") ?? "").trim().slice(0, 2000) || null,
      rarity: rarityRaw as never,
      quantity: Number.isFinite(quantity) && quantity >= 0 ? Math.floor(quantity) : 1,
      stats: stats as never
    }
  });
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "room-card-updated");
  redirect(returnTo);
}

/* ---------------- 道具 / 武器互转 ---------------- */


/**
 * 把一张卡在「道具卡 ↔ 武器卡」之间互转。
 *
 * 通用字段（效果 / 目标 / 消耗 / 可用场景 / 可选效果）原样保留；
 * 武器专属字段由武器类型自动生成，道具专属字段取默认值。
 * 转换后卡片会被卸下，需重新装备。
 */
export async function convertCardKindAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) return;
  const cardId = String(formData.get("cardId") ?? "");
  const targetKind = String(formData.get("targetKind") ?? "");
  if (cardId.length === 0) return;
  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null || card.ownerId !== session.user.id) return;

  const from = card.type;
  const parsed = convertCardStats(from as CardKind, targetKind as CardKind, card.stats);
  if (parsed === null) return;

  await prisma.card.update({
    where: { id: card.id },
    data: { type: targetKind as never, stats: parsed as unknown as Prisma.InputJsonValue, isEquipped: false, equipSlot: null, characterId: null }
  });
  revalidatePath("/cards");
  revalidatePath("/cards/" + card.id);
}
