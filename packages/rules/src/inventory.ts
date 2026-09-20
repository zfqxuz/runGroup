import { compile, evaluate } from "@touhou/formula";
import type { InventoryRules } from "./schema";

/**
 * 14.10 重量 / 14.11 财产的纯规则计算。
 *
 * 具体负重上限公式与生活费属于规则书数值，由规则包 / 模组提供；
 * 本文件只负责求值、汇总与超重 / 交易计算。
 */

function evalExpr(
  expression: string | undefined,
  vars: Readonly<Record<string, number>>,
  consts: Readonly<Record<string, number>>,
  fallback: number
): number {
  if (expression === undefined || expression.trim().length === 0) return fallback;
  try {
    const compiled = compile(expression, { vars: Object.keys(vars), consts: Object.keys(consts) });
    const value = evaluate(compiled, { vars, consts });
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 负重上限（千克）；规则包未填 carryCapacity 时返回 null（不限制）。 */
export function resolveCarryCapacity(
  rules: InventoryRules,
  vars: Readonly<Record<string, number>> = {},
  consts: Readonly<Record<string, number>> = {}
): number | null {
  if (rules.enabled !== true || rules.carryCapacity === undefined) return null;
  return round2(Math.max(0, evalExpr(rules.carryCapacity, vars, consts, 0)));
}

/** 14.3 地面拖拽上限；未配置时按 dragMultiplier 估算。 */
export function resolveDragCapacity(
  rules: InventoryRules,
  capacity: number,
  consts: Readonly<Record<string, number>> = {}
): number {
  return round2(Math.max(0, capacity) * Math.max(0, evalExpr(rules.dragMultiplier, {}, consts, 1.5)));
}

export interface EncumbranceInput {
  readonly capacity: number | null;
  /** 各物品重量列表。 */
  readonly weights: readonly number[];
}

export interface EncumbranceResult {
  readonly totalWeight: number;
  readonly capacity: number | null;
  /** 超出的重量；未超重为 0。 */
  readonly overloadUnits: number;
  /** 推倒应对 / 移动等判定的惩罚（由调用方决定用途）。 */
  readonly penalty: number;
  readonly overloaded: boolean;
}

/** 汇总物品重量并计算超重惩罚。 */
export function resolveEncumbrance(
  rules: InventoryRules,
  input: EncumbranceInput,
  vars: Readonly<Record<string, number>> = {},
  consts: Readonly<Record<string, number>> = {}
): EncumbranceResult {
  const totalWeight = input.weights.reduce(
    (sum, weight) => sum + (Number.isFinite(weight) ? Math.max(0, weight) : 0),
    0
  );
  const capacity = input.capacity;
  if (capacity === null || rules.enabled !== true) {
    return { totalWeight, capacity, overloadUnits: 0, penalty: 0, overloaded: false };
  }
  const overloadUnits = Math.max(0, totalWeight - capacity);
  const perUnit = Math.max(0, evalExpr(rules.overloadPenaltyPerUnit, vars, consts, 0));
  return {
    totalWeight,
    capacity,
    overloadUnits,
    penalty: overloadUnits * perUnit,
    overloaded: overloadUnits > 0
  };
}

export interface PropertyInput {
  /** 当前财产。 */
  readonly property: number;
  /** 本次支出。 */
  readonly spent: number;
}

export interface PropertyResult {
  readonly currencyName: string;
  readonly propertyBefore: number;
  readonly spent: number;
  readonly propertyAfter: number;
  readonly affordable: boolean;
  /** 用食物 / 魔法物品折算的等值点数。 */
  readonly tradeableValue: number;
}

/** 财产交易：扣款并给出可折算价值；不足时 affordable=false。 */
export function resolveProperty(
  rules: InventoryRules,
  input: PropertyInput,
  vars: Readonly<Record<string, number>> = {},
  consts: Readonly<Record<string, number>> = {}
): PropertyResult {
  const propertyBefore = Math.max(0, round2(input.property));
  const spent = Math.max(0, round2(input.spent));
  const rate = Math.max(0, evalExpr(rules.propertyTradeRate, vars, consts, 1));
  return {
    currencyName: rules.currencyName,
    propertyBefore,
    spent,
    propertyAfter: round2(Math.max(0, propertyBefore - spent)),
    affordable: spent <= propertyBefore,
    tradeableValue: round2(spent * rate)
  };
}

/** 开卡初始财产；规则包未启用时仍返回表达式结果（兼容默认 10）。 */
export function resolveStartingProperty(
  rules: InventoryRules,
  vars: Readonly<Record<string, number>> = {},
  consts: Readonly<Record<string, number>> = {}
): number {
  return round2(Math.max(0, evalExpr(rules.startingProperty, vars, consts, 10)));
}

/** 每天基本生活费（円）。 */
export function resolveLivingCost(
  rules: InventoryRules,
  vars: Readonly<Record<string, number>> = {},
  consts: Readonly<Record<string, number>> = {}
): number {
  return round2(Math.max(0, evalExpr(rules.livingCostPerDay, vars, consts, 0.1)));
}

export interface FoodCostRange {
  readonly min: number;
  readonly max: number;
  readonly currencyName: string;
}

/** 单日食品费用区间（wiki：5~10 钱）。 */
export function resolveFoodCostRange(
  rules: InventoryRules,
  consts: Readonly<Record<string, number>> = {}
): FoodCostRange {
  return {
    min: round2(Math.max(0, evalExpr(rules.foodCostMin, {}, consts, 0.05))),
    max: round2(Math.max(0, evalExpr(rules.foodCostMax, {}, consts, 0.1))),
    currencyName: rules.currencyName
  };
}
