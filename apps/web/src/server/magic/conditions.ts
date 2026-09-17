import {
  findCondition,
  parseConditions,
  tickConditions,
  type GameCondition
} from "@touhou/rules";
import { prisma } from "@/server/db/prisma";

export interface ConditionOwnerRef {
  readonly roomId?: string;
  readonly characterId?: string | null;
  readonly cardId?: string | null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/** 读取玩家角色的局内状态（按房间当前进行中的 game）。 */
export async function loadCharacterConditions(roomId: string, characterId: string): Promise<GameCondition[]> {
  const game = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (game === null) return [];
  const row = await prisma.gameCharacter.findUnique({
    where: { gameId_characterId: { gameId: game.id, characterId } },
    select: { conditions: true }
  });
  return parseConditions(row?.conditions);
}

export async function saveCharacterConditions(
  roomId: string,
  characterId: string,
  conditions: readonly GameCondition[]
): Promise<void> {
  const game = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (game === null) return;
  await prisma.gameCharacter.updateMany({
    where: { gameId: game.id, characterId },
    data: { conditions: conditions as never }
  });
}

export async function loadCardConditions(cardId: string): Promise<GameCondition[]> {
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { stats: true } });
  return parseConditions(recordOf(card?.stats).conditions);
}

export async function saveCardConditions(cardId: string, conditions: readonly GameCondition[]): Promise<void> {
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { stats: true } });
  if (card === null) return;
  const stats = recordOf(card.stats);
  stats.conditions = conditions;
  await prisma.card.update({ where: { id: cardId }, data: { stats: stats as never } });
}

export async function loadConditionsForOwner(owner: ConditionOwnerRef): Promise<GameCondition[]> {
  if (owner.characterId !== null && owner.characterId !== undefined && owner.characterId.length > 0) {
    return loadCharacterConditions(owner.roomId ?? "", owner.characterId);
  }
  if (owner.cardId !== null && owner.cardId !== undefined && owner.cardId.length > 0) {
    return loadCardConditions(owner.cardId);
  }
  return [];
}

export interface ConsumeChargeResult {
  /** 是否存在可消耗的充能状态。 */
  readonly consumed: boolean;
  /** 剩余充能；null 表示没有 POSSESS 充能状态。 */
  readonly remaining: number | null;
  /** 本次消耗后是否到期。 */
  readonly expired: boolean;
}

/** 读取 Token 对应实体的夺舍充能剩余量；null 表示未被夺舍。 */
export async function possessChargeForToken(input: {
  readonly roomId: string;
  readonly characterId: string | null;
  readonly cardId: string | null;
}): Promise<number | null> {
  const conditions =
    input.characterId !== null && input.characterId.length > 0
      ? await loadCharacterConditions(input.roomId, input.characterId)
      : input.cardId !== null && input.cardId.length > 0
        ? await loadCardConditions(input.cardId)
        : [];
  const possess = findCondition(conditions, "POSSESS");
  if (possess === null || possess.duration.unit !== "CHARGE") return null;
  return Math.max(0, Math.floor(possess.duration.remaining));
}

/**
 * 消耗一次「被夺舍 Token 移动」充能。
 * 只有 POSSESS 且单位为 CHARGE 的状态会被扣减；到期后清除状态并释放控制权。
 */
export async function consumePossessCharge(input: {
  readonly roomId: string;
  readonly characterId: string | null;
  readonly cardId: string | null;
}): Promise<ConsumeChargeResult> {
  const conditions =
    input.characterId !== null && input.characterId.length > 0
      ? await loadCharacterConditions(input.roomId, input.characterId)
      : input.cardId !== null && input.cardId.length > 0
        ? await loadCardConditions(input.cardId)
        : [];
  const possess = findCondition(conditions, "POSSESS");
  if (possess === null || possess.duration.unit !== "CHARGE") {
    return { consumed: false, remaining: null, expired: false };
  }
  const result = tickConditions(conditions, "CHARGE", 1);
  const nextPossess = findCondition(result.conditions, "POSSESS");
  if (input.characterId !== null && input.characterId.length > 0) {
    await saveCharacterConditions(input.roomId, input.characterId, result.conditions);
  } else if (input.cardId !== null && input.cardId.length > 0) {
    await saveCardConditions(input.cardId, result.conditions);
  }
  return {
    consumed: true,
    remaining: nextPossess === null ? 0 : nextPossess.duration.remaining,
    expired: nextPossess === null
  };
}

/** 给目标追加 / 覆盖一条局内状态（战斗外施法用）。 */
export async function upsertConditionForOwner(
  owner: ConditionOwnerRef,
  condition: GameCondition
): Promise<void> {
  const conditions = await loadConditionsForOwner(owner);
  const index = conditions.findIndex((item) => item.id === condition.id || item.type === condition.type);
  const next = index < 0 ? [...conditions, condition] : conditions.map((item, i) => (i === index ? condition : item));
  if (owner.characterId !== null && owner.characterId !== undefined && owner.characterId.length > 0) {
    await saveCharacterConditions(owner.roomId ?? "", owner.characterId, next);
  } else if (owner.cardId !== null && owner.cardId !== undefined && owner.cardId.length > 0) {
    await saveCardConditions(owner.cardId, next);
  }
}
