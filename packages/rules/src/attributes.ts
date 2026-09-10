import { parseDice, rollDice, type Rng } from "@touhou/formula";
import type { AttributeMethod } from "./schema";
import { ATTRIBUTE_KEYS, type AttributeKey, type AttributeSet } from "./types";

export interface AttributeSetOption {
  readonly index: number;
  readonly attributes: AttributeSet;
  readonly total: number;
}

export interface PointBuyCheck {
  readonly total: number;
  readonly remaining: number;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function toAttributeSet(values: readonly number[]): AttributeSet {
  const result: Record<string, number> = {};
  for (let i = 0; i < ATTRIBUTE_KEYS.length; i += 1) {
    const key = ATTRIBUTE_KEYS[i] as string;
    result[key] = values[i] ?? 0;
  }
  return result as unknown as AttributeSet;
}

export function attributeTotal(attributes: AttributeSet): number {
  let total = 0;
  for (const key of ATTRIBUTE_KEYS) total += attributes[key];
  return total;
}

/**
 * 天命法：掷 N 组，每组每项 NdM×倍率，返回全部组供玩家挑选。
 * 顺序固定为 ATTRIBUTE_KEYS（八维 + 幸运）。
 */
export function rollAttributeSets(
  method: Extract<AttributeMethod, { kind: "ROLL_SETS" }>,
  rng: Rng
): AttributeSetOption[] {
  const dice = parseDice(method.dice);
  const options: AttributeSetOption[] = [];

  for (let setIndex = 0; setIndex < method.sets; setIndex += 1) {
    const values: number[] = [];
    for (let i = 0; i < ATTRIBUTE_KEYS.length; i += 1) {
      values.push(rollDice(dice, rng).total * method.multiplier);
    }
    const attributes = toAttributeSet(values);
    options.push({ index: setIndex, attributes, total: attributeTotal(attributes) });
  }

  return options;
}

/** 购点校验：单项上下限 + 总和必须刚好用完。 */
export function checkPointBuy(
  method: Extract<AttributeMethod, { kind: "POINT_BUY" }>,
  attributes: AttributeSet
): PointBuyCheck {
  const errors: string[] = [];

  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    const value = attributes[key];
    if (Number.isInteger(value) === false) {
      errors.push(`${key} 必须是整数`);
      continue;
    }
    if (value < method.perAttributeMin) {
      errors.push(`${key} 低于下限 ${method.perAttributeMin}`);
    }
    if (value > method.perAttributeMax) {
      errors.push(`${key} 高于上限 ${method.perAttributeMax}`);
    }
  }

  const total = attributeTotal(attributes);
  const remaining = method.total - total;
  if (remaining !== 0) {
    errors.push(remaining > 0 ? `还剩 ${remaining} 点未分配` : `超出 ${-remaining} 点`);
  }

  return { total, remaining, valid: errors.length === 0, errors };
}
