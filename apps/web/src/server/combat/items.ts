import type { ActionSubmission, CombatParticipantState } from "@touhou/combat";
import type { CompiledRulePack } from "@touhou/rules";
import { prisma } from "@/server/db/prisma";
import { ItemStatsSchema, activeCardEffects } from "@/shared/card";
import type { CombatItemOption } from "@/shared/combat-items";

export type { CombatItemOption };

export interface ItemParticipantRef {
  readonly id: string;
  readonly characterId: string | null;
}


/**
 * 载入每个参战单位可用的道具卡。
 *
 * 只读「玩家角色已装备的 ITEM 卡」；NPC 与未装备卡不参与。
 * 卡上 effects 为空时也保留（前端会提示没有效果）。
 */
export async function loadItemsByParticipant(
  participants: readonly ItemParticipantRef[]
): Promise<Map<string, readonly CombatItemOption[]>> {
  const result = new Map<string, readonly CombatItemOption[]>();
  const characterIds = participants
    .map((participant) => participant.characterId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (characterIds.length === 0) return result;

  const cards = await prisma.card.findMany({
    where: {
      characterId: { in: characterIds },
      type: "ITEM",
      isEquipped: true
    },
    select: { id: true, name: true, stats: true, characterId: true },
    orderBy: { createdAt: "asc" }
  });

  const byCharacter = new Map<string, CombatItemOption[]>();
  for (const card of cards) {
    if (card.characterId === null) continue;
    const parsed = ItemStatsSchema.safeParse(card.stats);
    if (parsed.success === false) continue;
    const stats = parsed.data;
    if (stats.usableIn.includes("COMBAT") === false) continue;
    const option: CombatItemOption = {
      cardId: card.id,
      name: card.name,
      targeting: stats.targeting,
      targetScope: stats.targetScope,
      effects: activeCardEffects(stats),
      cost: stats.cost,
      usableIn: stats.usableIn
    };
    const list = byCharacter.get(card.characterId) ?? [];
    list.push(option);
    byCharacter.set(card.characterId, list);
  }

  for (const participant of participants) {
    if (participant.characterId === null) continue;
    const list = byCharacter.get(participant.characterId);
    if (list === undefined) continue;
    result.set(participant.id, list);
  }
  return result;
}

export type PrepareItemResult =
  | { readonly ok: true; readonly action: ActionSubmission; readonly item: CombatItemOption }
  | { readonly ok: false; readonly error: string };

/**
 * 服务端接管道具数值：客户端只能传 cardId。
 * 效果、目标、消耗都以卡牌数据为准，客户端无法伪造。
 */
export function prepareItemAction(
  pack: CompiledRulePack,
  actor: CombatParticipantState,
  cards: readonly CombatItemOption[],
  action: ActionSubmission,
  round: number
): PrepareItemResult {
  if (actor.defeated) return { ok: false, error: "该单位已退场" };
  const cardId = action.itemCardId;
  if (typeof cardId !== "string" || cardId.length === 0) {
    return { ok: false, error: "请选择要使用的道具" };
  }
  const item = cards.find((entry) => entry.cardId === cardId);
  if (item === undefined) return { ok: false, error: "该角色没有装备这件道具" };
  if (item.usableIn.includes("COMBAT") === false) {
    return { ok: false, error: "「" + item.name + "」不能在战斗中使用" };
  }
  if (item.effects.length === 0) {
    return { ok: false, error: "「" + item.name + "」没有可用于战斗的效果" };
  }
  for (const effect of item.effects) {
    if (effect.type === "STATUS" && pack.statusEffects[effect.key] === undefined) {
      return { ok: false, error: "「" + item.name + "」使用了规则包未定义的状态 key：「" + effect.key + "」" };
    }
  }
  if (item.cost.uses !== null) {
    const left = actor.itemUsesLeft?.[cardId] ?? item.cost.uses;
    if (left <= 0) return { ok: false, error: "「" + item.name + "」的使用次数已用尽" };
  }
  const cooldownUntil = actor.itemCooldownUntil?.[cardId] ?? 0;
  if (cooldownUntil > round) {
    return { ok: false, error: "「" + item.name + "」冷却中，第 " + cooldownUntil + " 轮后才能再次使用" };
  }
  if (item.cost.mp > actor.mp) {
    return { ok: false, error: "灵力不足，无法使用「" + item.name + "」" };
  }

  const targetScope = item.targetScope === "SELF" || item.targeting === "SELF" ? "SELF" : item.targetScope;
  const targetId =
    targetScope === "SELF"
      ? actor.id
      : targetScope === "ALL"
        ? null
        : action.targetId ?? null;
  return {
    ok: true,
    item,
    action: {
      ...action,
      kind: "ITEM",
      name: item.name,
      itemCardId: cardId,
      targetId,
      effects: item.effects,
      targeting: item.targeting,
      targetScope,
      mpCost: item.cost.mp,
      sanCost: item.cost.san ?? undefined
    }
  };
}

/** 使用后扣减次数并写入冷却；由 socket 层在服务端权威结算。 */
export function consumeItemUse(
  actor: CombatParticipantState,
  item: CombatItemOption,
  round: number
): void {
  if (item.cost.uses !== null) {
    const left = actor.itemUsesLeft?.[item.cardId] ?? item.cost.uses;
    actor.itemUsesLeft = { ...(actor.itemUsesLeft ?? {}), [item.cardId]: Math.max(0, left - 1) };
  }
  if (item.cost.cooldownRounds > 0) {
    actor.itemCooldownUntil = {
      ...(actor.itemCooldownUntil ?? {}),
      [item.cardId]: round + item.cost.cooldownRounds
    };
  }
}
