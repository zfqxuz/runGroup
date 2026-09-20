import type { BarrierRules, BarrierTier } from "./schema";

/**
 * 7.5 结界系法术通用规则（wiki 表 7.1）。
 *
 * 数值表由规则包 / 模组通过 `RulePack.barrier` 提供；本文件负责按大小查表、
 * 处理超出最大档位的线性扩展、持续时间、回避目标值与结界内战斗惩罚。
 */

function sortedTiers(rules: BarrierRules): readonly BarrierTier[] {
  return [...rules.tiers].sort((a, b) => a.sizeMeters - b.sizeMeters);
}

/** 取 <= 指定大小的最高档；小于最小档时取最小档，超出最大档时按 extended 线性扩展。 */
export function barrierTierForSize(
  rules: BarrierRules,
  sizeMeters: number
): { readonly tier: BarrierTier | null; readonly extraSteps: number } {
  const size = Math.max(0, sizeMeters);
  const tiers = sortedTiers(rules);
  if (tiers.length === 0) return { tier: null, extraSteps: 0 };
  const first = tiers[0]!;
  if (size < first.sizeMeters) return { tier: first, extraSteps: 0 };
  let match = first;
  for (const tier of tiers) {
    if (tier.sizeMeters <= size) match = tier;
    else break;
  }
  const largest = tiers[tiers.length - 1]!;
  if (size <= largest.sizeMeters) return { tier: match, extraSteps: 0 };
  const step = rules.extended.sizeStepMeters;
  if (step <= 0) return { tier: largest, extraSteps: 0 };
  const extraSteps = Math.ceil((size - largest.sizeMeters) / step);
  return { tier: largest, extraSteps };
}

export interface BarrierStatsInput {
  /** 结界大小（米）。 */
  readonly sizeMeters: number;
  /** 施术者【神术·阴阳术】等级；决定持续时间。 */
  readonly casterLevel?: number;
  /** 结界 HP；通常来自法术卡 effect.hp 的掷骰结果。 */
  readonly fallbackHp?: number;
}
export interface BarrierStats {
  readonly sizeMeters: number;
  readonly tierId: string | null;
  readonly tierName: string | null;
  readonly requiredLevel: number;
  readonly targetValue: number;
  readonly mpCost: number;
  readonly durationHours: number;
  /** 结界内战斗惩罚（回避减值）。 */
  readonly penalty: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly extraSteps: number;
}

/** 按 7.5 表 7.1 求值；未启用返回 null，调用方回退到卡面数据。 */
export function resolveBarrierStats(rules: BarrierRules, input: BarrierStatsInput): BarrierStats | null {
  if (rules.enabled !== true) return null;
  const sizeMeters = Math.max(0, input.sizeMeters);
  const { tier, extraSteps } = barrierTierForSize(rules, sizeMeters);
  if (tier === null) return null;
  const ext = rules.extended;
  const requiredLevel = tier.requiredLevel + extraSteps * ext.requiredLevelPerStep;
  const targetValue = tier.targetValue + extraSteps * ext.targetValuePerStep;
  const mpCost = tier.mpCost + extraSteps * ext.mpCostPerStep;
  const casterLevel = Math.max(0, Math.floor(input.casterLevel ?? 0));
  const hp = Math.max(0, Math.round(input.fallbackHp ?? 0));
  return {
    sizeMeters,
    tierId: tier.id,
    tierName: tier.name,
    requiredLevel,
    targetValue,
    mpCost,
    durationHours: casterLevel * rules.durationHoursPerLevel,
    penalty: barrierConfinementPenalty(rules, sizeMeters),
    hp,
    maxHp: hp,
    extraSteps
  };
}

/** 结界内战斗惩罚：自由行动范围越小惩罚越高。 */
export function barrierConfinementPenalty(rules: BarrierRules, freeSpaceMeters: number): number {
  const meters = Math.max(0, freeSpaceMeters);
  const sorted = [...rules.confinementPenalties].sort((a, b) => a.maxMeters - b.maxMeters);
  for (const entry of sorted) {
    if (meters <= entry.maxMeters) return Math.max(0, entry.penalty);
  }
  return 0;
}

/** 7.5：回避结界生成的目标值 = 达成值 + floor(大小 / 除数)，最多消费 3 DP。 */
export function barrierDodgeTargetValue(
  achievement: number,
  sizeMeters: number,
  rules: BarrierRules
): number {
  const divisor = rules.dodgeSizeDivisor > 0 ? rules.dodgeSizeDivisor : 2;
  return Math.max(0, Math.floor(achievement)) + Math.floor(Math.max(0, sizeMeters) / divisor);
}

/** 扩大 / 缩小每一步（每级）的灵力消耗。 */
export function barrierResizeCost(rules: BarrierRules, steps: number): number {
  return Math.max(0, Math.floor(steps)) * Math.max(0, rules.resizeMpCost);
}

export interface BarrierResizeInput {
  readonly hp: number;
  readonly maxHp: number;
  readonly direction: "EXPAND" | "SHRINK";
  /** 等级变化量；默认 1。 */
  readonly amount?: number;
}

export interface BarrierResizeResult {
  readonly levelDelta: number;
  readonly hp: number;
  readonly maxHp: number;
  /** 缩小到 0 级视为自行消散。 */
  readonly collapsed: boolean;
}

/** 扩大 / 缩小时按当前 HP 比例迁移到新上限。 */
export function resizeBarrierHp(input: BarrierResizeInput, newMaxHp: number): BarrierResizeResult {
  const amount = Math.max(1, Math.floor(input.amount ?? 1));
  const levelDelta = input.direction === "EXPAND" ? amount : -amount;
  const maxHp = Math.max(0, Math.round(newMaxHp));
  const ratio = input.maxHp > 0 ? Math.max(0, Math.min(1, input.hp / input.maxHp)) : 1;
  const hp = maxHp <= 0 ? 0 : Math.max(0, Math.round(maxHp * ratio));
  return { levelDelta, hp, maxHp, collapsed: maxHp <= 0 };
}

export interface BarrierDispelInput {
  readonly achievement: number;
  readonly targetValue: number;
  readonly needsContest: boolean;
}

/** 解除结界：需要对抗时比较达成值与结界目标值；不需要对抗则直接成功。 */
export function barrierDispelSuccess(input: BarrierDispelInput): boolean {
  if (input.needsContest !== true) return true;
  return input.achievement >= input.targetValue;
}

/** 同一目标重复展开时的处理结果。 */
export function barrierRestackOutcome(
  restack: BarrierRules["restack"],
  existingHp: number,
  existingMaxHp: number,
  incomingHp: number
): { readonly hp: number; readonly maxHp: number; readonly replaced: boolean } {
  if (restack === "STACK") {
    const maxHp = existingMaxHp + incomingHp;
    return { hp: existingHp + incomingHp, maxHp, replaced: false };
  }
  if (restack === "REFRESH") {
    const maxHp = Math.max(existingMaxHp, incomingHp);
    return { hp: Math.max(existingHp, incomingHp), maxHp, replaced: false };
  }
  return { hp: incomingHp, maxHp: incomingHp, replaced: true };
}
