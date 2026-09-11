import type { AttributeSet } from "./types";

/** COC7 年龄补正可扣减的物理属性。 */
export type Coc7PhysicalAttribute = "str" | "con" | "siz" | "dex";

/**
 * 体格 Build。
 * STR + SIZ 的基础区间：-2 / -1 / 0 / +1 / +2 / +3；
 * 205 起每多 80 点体格 +1。
 */
export function coc7Build(strPlusSiz: number): number {
  if (strPlusSiz <= 64) return -2;
  if (strPlusSiz <= 84) return -1;
  if (strPlusSiz <= 124) return 0;
  if (strPlusSiz <= 164) return 1;
  if (strPlusSiz <= 204) return 2;
  return 3 + Math.floor((strPlusSiz - 205) / 80);
}

/** 由体格换算伤害加值表达式。 */
export function coc7DamageBonusFromBuild(build: number): string {
  if (build <= -2) return "-2";
  if (build === -1) return "-1";
  if (build === 0) return "0";
  if (build === 1) return "1d4";
  return `${build - 1}d6`;
}

/**
 * COC 7e 伤害加值（Damage Bonus，DB）。
 * 根据 STR + SIZ 查表，返回可直接拼进伤害表达式的字符串。
 */
export function coc7DamageBonus(strPlusSiz: number): string {
  return coc7DamageBonusFromBuild(coc7Build(strPlusSiz));
}

export interface Coc7MovementInput {
  readonly str: number;
  readonly siz: number;
  readonly dex: number;
  /** 年龄；缺省视为 20-39，无年龄 MOV 减值。 */
  readonly age?: number | null;
  /** 护甲造成的 MOV 减值（正整数）。 */
  readonly armorPenalty?: number | null;
}

/**
 * 移动力 MOV。
 * 基础 8；STR 与 DEX 同时大于 SIZ +1，同时小于 SIZ -1；
 * 40 岁起按年龄段扣减（40-49 -> 1，50-59 -> 2，以此类推）。
 */
export function coc7Movement(input: Coc7MovementInput): number {
  const str = Math.floor(input.str);
  const siz = Math.floor(input.siz);
  const dex = Math.floor(input.dex);
  const comparison = Math.sign(str - siz) + Math.sign(dex - siz);
  const sizeBonus = comparison >= 2 ? 1 : comparison <= -2 ? -1 : 0;
  const age = input.age === undefined || input.age === null ? 0 : Math.floor(input.age);
  const agePenalty = age < 40 ? 0 : Math.max(0, Math.floor(age / 10) - 3);
  const armorPenalty = Math.max(0, Math.floor(input.armorPenalty ?? 0));
  return Math.max(0, 8 + sizeBonus - agePenalty - armorPenalty);
}

/** 重伤值：Excel 为 CEILING(HP / 2, 1)。 */
export function coc7MajorWound(maxHp: number): number {
  return Math.max(0, Math.ceil(Math.max(0, Math.floor(maxHp)) / 2));
}

export interface Coc7AgeAdjustment {
  readonly age: number;
  /** STR/CON/DEX/SIZ 中需要玩家分配的扣减总额。 */
  readonly deductionTotal: number;
  /** 允许分配扣减的属性。 */
  readonly deductionAttributes: readonly Coc7PhysicalAttribute[];
  /** APP 固定减值。 */
  readonly appPenalty: number;
  /** EDU 固定减值（15-19 专用）。 */
  readonly eduPenalty: number;
  /** EDU 成长判定次数。 */
  readonly eduChecks: number;
  /** MOV 固定减值。 */
  readonly movePenalty: number;
  /** 幸运掷骰次数；2 表示掷两次取高。 */
  readonly luckRolls: number;
}

/**
 * COC7 建卡年龄补正（非累积，只取当前年龄段一档）。
 * 15-19：STR/SIZ 共 -5，EDU -5，幸运掷两次取高。
 * 20-39：1 次 EDU 成长。
 * 40+：STR/CON/DEX 共扣若干，APP 固定减值，EDU 成长次数，MOV 减值。
 */
export function coc7AgeAdjustment(ageInput: number): Coc7AgeAdjustment {
  const age = Math.max(0, Math.floor(ageInput));
  if (age < 20) {
    return {
      age,
      deductionTotal: 5,
      deductionAttributes: ["str", "siz"],
      appPenalty: 0,
      eduPenalty: 5,
      eduChecks: 0,
      movePenalty: 0,
      luckRolls: 2
    };
  }
  if (age < 40) {
    return {
      age,
      deductionTotal: 0,
      deductionAttributes: [],
      appPenalty: 0,
      eduPenalty: 0,
      eduChecks: 1,
      movePenalty: 0,
      luckRolls: 1
    };
  }
  if (age < 50) {
    return {
      age,
      deductionTotal: 5,
      deductionAttributes: ["str", "con", "dex"],
      appPenalty: 5,
      eduPenalty: 0,
      eduChecks: 2,
      movePenalty: 1,
      luckRolls: 1
    };
  }
  if (age < 60) {
    return {
      age,
      deductionTotal: 10,
      deductionAttributes: ["str", "con", "dex"],
      appPenalty: 10,
      eduPenalty: 0,
      eduChecks: 3,
      movePenalty: 2,
      luckRolls: 1
    };
  }
  if (age < 70) {
    return {
      age,
      deductionTotal: 20,
      deductionAttributes: ["str", "con", "dex"],
      appPenalty: 15,
      eduPenalty: 0,
      eduChecks: 4,
      movePenalty: 3,
      luckRolls: 1
    };
  }
  if (age < 80) {
    return {
      age,
      deductionTotal: 40,
      deductionAttributes: ["str", "con", "dex"],
      appPenalty: 20,
      eduPenalty: 0,
      eduChecks: 4,
      movePenalty: 4,
      luckRolls: 1
    };
  }
  return {
    age,
    deductionTotal: 80,
    deductionAttributes: ["str", "con", "dex"],
    appPenalty: 25,
    eduPenalty: 0,
    eduChecks: 4,
    movePenalty: 5,
    luckRolls: 1
  };
}

export type Coc7AgeAllocation = Partial<Record<Coc7PhysicalAttribute, number>>;

export interface Coc7AgeAllocationCheck {
  readonly ok: boolean;
  readonly total: number;
  readonly expected: number;
  readonly errors: readonly string[];
  readonly adjustment: Coc7AgeAdjustment;
}

/** 校验玩家对年龄扣减的一次性分配。 */
export function checkCoc7AgeAllocation(
  age: number,
  allocation: Coc7AgeAllocation
): Coc7AgeAllocationCheck {
  const adjustment = coc7AgeAdjustment(age);
  const errors: string[] = [];
  const allowed = new Set<Coc7PhysicalAttribute>(adjustment.deductionAttributes);
  let total = 0;
  for (const key of ["str", "con", "siz", "dex"] as const) {
    const raw = allocation[key];
    if (raw === undefined || raw === null) continue;
    const value = Math.floor(Number(raw));
    if (Number.isFinite(value) === false || value < 0) {
      errors.push(key + " 的扣减必须是大于等于 0 的整数");
      continue;
    }
    if (value > 0 && allowed.has(key) === false) {
      errors.push(key + " 不在该年龄段的可扣属性中");
      continue;
    }
    total += value;
  }
  if (total !== adjustment.deductionTotal) {
    errors.push("扣减总额为 " + total + "，应为 " + adjustment.deductionTotal);
  }
  return {
    ok: errors.length === 0,
    total,
    expected: adjustment.deductionTotal,
    errors,
    adjustment
  };
}

/** 应用年龄补正，返回新的属性对象（不修改传入对象）。 */
export function applyCoc7AgeAdjustment(
  attributes: AttributeSet,
  age: number,
  allocation: Coc7AgeAllocation
): AttributeSet {
  const adjustment = coc7AgeAdjustment(age);
  const result: Record<string, number> = { ...attributes };
  for (const key of adjustment.deductionAttributes) {
    const raw = allocation[key] ?? 0;
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    result[key] = Math.max(0, (result[key] ?? 0) - value);
  }
  result.app = Math.max(0, (result.app ?? 0) - adjustment.appPenalty);
  result.edu = Math.max(0, (result.edu ?? 0) - adjustment.eduPenalty);
  return result as unknown as AttributeSet;
}
