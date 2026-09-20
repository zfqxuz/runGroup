import { compile, evaluate } from "@touhou/formula";
import type { BarrierLevel, BarrierRules, BarrierSize } from "./schema";

/**
 * 7.5 结界系法术通用规则（架构层）。
 *
 * 具体「大小 / 等级 / 目标值 / 灵力消耗表」是规则书数值，由规则包 / 模组
 * 通过 `RulePack.barrier` 提供；本文件只负责查表、求值与对抗判定。
 * 规则包未启用或没有对应等级档时，调用方回退到法术卡自带的 `hp`。
 */

function evalExpr(
  expression: string,
  vars: Readonly<Record<string, number>>,
  consts: Readonly<Record<string, number>>
): number {
  const compiled = compile(expression, { vars: Object.keys(vars), consts: Object.keys(consts) });
  const value = evaluate(compiled, { vars, consts });
  return Number.isFinite(value) ? value : 0;
}

/** 取 <= 请求等级的最高档；请求等级低于最小档时取最小档。 */
export function barrierLevelEntry(rules: BarrierRules, level: number): BarrierLevel | null {
  if (rules.levels.length === 0) return null;
  const sorted = [...rules.levels].sort((a, b) => a.level - b.level);
  const requested = Math.max(1, Math.floor(level));
  if (requested < sorted[0]!.level) return sorted[0]!;
  let match: BarrierLevel | null = null;
  for (const entry of sorted) {
    if (entry.level <= requested) match = entry;
    else break;
  }
  return match;
}

export interface BarrierStatsInput {
  readonly level: number;
  readonly sizeId?: string | null;
  /** 查表失败时使用的 HP（通常来自法术卡 effect.hp）。 */
  readonly fallbackHp?: number;
  readonly vars?: Readonly<Record<string, number>>;
  readonly consts?: Readonly<Record<string, number>>;
}

export interface BarrierStats {
  readonly level: number;
  readonly sizeId: string | null;
  readonly sizeName: string | null;
  readonly hp: number;
  readonly maxHp: number;
  readonly targetValue: number;
  readonly mpCost: number;
  readonly durationTicks: number;
  /** 结界内战斗惩罚（达成值减值）。 */
  readonly penalty: number;
  readonly scopeMeters: number;
  readonly capacity: number;
}

/** 按规则包结界表求值；未启用返回 null，调用方回退到卡面数据。 */
export function resolveBarrierStats(
  rules: BarrierRules,
  input: BarrierStatsInput
): BarrierStats | null {
  if (rules.enabled !== true) return null;
  const vars = input.vars ?? {};
  const consts = input.consts ?? {};
  const level = Math.max(1, Math.floor(input.level));
  const entry = barrierLevelEntry(rules, level);
  const sizeId = input.sizeId ?? null;
  const size: BarrierSize | undefined = sizeId === null ? undefined : rules.sizes[sizeId];
  const baseHp = entry === null ? Math.max(0, input.fallbackHp ?? 0) : evalExpr(entry.hp, vars, consts);
  const hpMultiplier = size === undefined ? 1 : evalExpr(size.hpMultiplier, vars, consts);
  const hp = Math.max(0, Math.round(baseHp * hpMultiplier));
  const targetValue = entry === null ? 0 : Math.max(0, Math.round(evalExpr(entry.targetValue, vars, consts)));
  const mpCost = entry === null ? 0 : Math.max(0, Math.round(evalExpr(entry.mpCost, vars, consts) * (size === undefined ? 1 : evalExpr(size.mpMultiplier, vars, consts))));
  const durationTicks = entry === null ? 0 : Math.max(0, Math.floor(evalExpr(entry.durationTicks, vars, consts)));
  const penalty = size === undefined ? 0 : Math.max(0, evalExpr(size.penalty, vars, consts));
  const scopeMeters = size === undefined ? 0 : Math.max(0, evalExpr(size.scopeMeters, vars, consts));
  const capacity = size === undefined ? 0 : Math.max(0, size.capacity);
  return {
    level,
    sizeId: size?.id ?? null,
    sizeName: size?.name ?? null,
    hp,
    maxHp: hp,
    targetValue,
    mpCost,
    durationTicks,
    penalty,
    scopeMeters,
    capacity
  };
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
export function resizeBarrierHp(
  input: BarrierResizeInput,
  newMaxHp: number
): BarrierResizeResult {
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
