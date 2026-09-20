import { abilitySpendTotal, abilityTotalCost } from "./abilities";
import type { AbilityCategory, AbilityRules, GrowthRank } from "./schema";

/** 妖术 / 锻炼 / 同效果魔法物品：单个能力最多使用成长能力点的 60%（向上取整）。 */
export const TOUHOU_RESTRICTED_GROWTH_RATIO = 0.6;
/** 开卡时【妖术】最高 4 级。 */
export const TOUHOU_YOUJUTSU_CREATION_MAX = 4;
/** 开卡时 SC 持有数。 */
export const TOUHOU_STARTING_SPELLCARDS = 3;
/** 开卡时 HP 系数。 */
export const TOUHOU_STARTING_HP_COEFFICIENT = 4;

export interface TouhouGrowthAssignment {
  readonly attribute?: string;
  readonly skill?: string;
  readonly ability?: string;
  /** HP 系数与 SC 共用一个成长等级。 */
  readonly hpSpellcard?: string;
}

export interface TouhouGrowthGrant {
  readonly attribute: number;
  readonly skill: number;
  readonly ability: number;
  readonly hpCoefficient: number;
  readonly spellcard: number;
}

function rankOf(rules: AbilityRules, grade: string | undefined): GrowthRank | null | undefined {
  if (grade === undefined) return undefined;
  return rules.growthRanks[grade] ?? null;
}

/**
 * 把 GM 给的成长等级分配到四类，返回每一类获得的成长量。
 * - attribute / skill / ability 各占一个等级；
 * - HP 系数与 SC 共用一个等级，但各取表中的不同数值。
 * 任一 grade 未定义时返回 null。
 */
export function touhouGrowthGrant(
  rules: AbilityRules,
  assignment: TouhouGrowthAssignment
): TouhouGrowthGrant | null {
  const attribute = rankOf(rules, assignment.attribute);
  const skill = rankOf(rules, assignment.skill);
  const ability = rankOf(rules, assignment.ability);
  const hpSpellcard = rankOf(rules, assignment.hpSpellcard);
  if (attribute === null || skill === null || ability === null || hpSpellcard === null) return null;
  return {
    attribute: attribute?.attribute ?? 0,
    skill: skill?.skill ?? 0,
    ability: ability?.ability ?? 0,
    hpCoefficient: hpSpellcard?.hpCoefficient ?? 0,
    spellcard: hpSpellcard?.spellcard ?? 0
  };
}

/** 特性值成长：n→n+1 花费 n+1 点，累加到目标值。 */
export function touhouAttributeGrowthCost(from: number, to: number): number {
  const start = Math.max(0, Math.floor(from));
  const end = Math.max(start, Math.floor(to));
  let total = 0;
  for (let current = start; current < end; current += 1) {
    total += current + 1;
  }
  return total;
}

/** 技能成长：升到第 L 级花 L 点，5 级及以后固定 5 点。 */
export function touhouSkillGrowthStepCost(nextLevel: number): number {
  return Math.min(Math.max(1, Math.floor(nextLevel)), 5);
}

/** 技能累计成长花费。 */
export function touhouSkillGrowthCost(from: number, to: number): number {
  const start = Math.max(0, Math.floor(from));
  const end = Math.max(start, Math.floor(to));
  let total = 0;
  for (let current = start; current < end; current += 1) {
    total += touhouSkillGrowthStepCost(current + 1);
  }
  return total;
}

/** 技能一次最多成长 1 级；返回问题描述，合法时返回 null。 */
export function touhouSkillGrowthIssue(from: number, to: number): string | null {
  if (Math.floor(to) - Math.floor(from) > 1) {
    return "一次成长最多提升 1 级（需数月以上空闲且 GM 许可才能连续提升）";
  }
  return null;
}

/** 能力成长累计花费（与开卡同一张消费表）。 */
export function touhouAbilityGrowthCost(
  category: AbilityCategory,
  from: number,
  to: number
): number {
  const start = Math.max(0, Math.floor(from));
  const end = Math.max(start, Math.floor(to));
  return abilityTotalCost(category, end) - abilityTotalCost(category, start);
}

/** 一组能力等级（从 0 起）的成长总花费。 */
export function touhouAbilityGrowthSpent(
  rules: AbilityRules,
  levels: Readonly<Record<string, number>>
): number {
  return abilitySpendTotal(rules, levels);
}

/** 妖术 / 锻炼单个能力的成长上限：成长能力点总额的 60%，向上取整。 */
export function touhouRestrictedGrowthCap(totalAbilityGrowthPoints: number): number {
  return Math.ceil(Math.max(0, totalAbilityGrowthPoints) * TOUHOU_RESTRICTED_GROWTH_RATIO);
}

/** 校验单个受限制能力（妖术 / 锻炼）是否超过 60% 上限。 */
export function touhouRestrictedGrowthIssue(
  totalAbilityGrowthPoints: number,
  spentOnAbility: number
): string | null {
  const cap = touhouRestrictedGrowthCap(totalAbilityGrowthPoints);
  if (Math.floor(spentOnAbility) > cap) {
    return `单个妖术 / 锻炼最多使用成长能力点的 60%（上限 ${cap}，已用 ${Math.floor(spentOnAbility)}）`;
  }
  return null;
}

/** SC / HP 系数成长按小数累计；SC 实际持有数向下取整。 */
export function touhouSpellcardPoolAfter(currentPool: number, rankValue: number): number {
  const current = Number.isFinite(currentPool) ? Math.max(0, currentPool) : 0;
  const add = Number.isFinite(rankValue) ? Math.max(0, rankValue) : 0;
  return current + add;
}

export function touhouSpellcardCount(pool: number): number {
  return Math.floor(Number.isFinite(pool) ? Math.max(0, pool) : 0);
}

export function touhouHpCoefficientAfter(current: number, rankValue: number): number {
  const base = Number.isFinite(current) ? Math.max(0, current) : 0;
  const add = Number.isFinite(rankValue) ? Math.max(0, rankValue) : 0;
  return base + add;
}

/** HP = 10 + {耐久} × HP系数，向上取整（13.2.4）。 */
export function touhouHpFromCoefficient(con: number, hpCoefficient: number): number {
  const durability = Number.isFinite(con) ? Math.floor(con) : 0;
  const coefficient = Number.isFinite(hpCoefficient) ? Math.max(0, hpCoefficient) : 0;
  return Math.max(0, Math.ceil(10 + durability * coefficient));
}

/** 【妖术】总数上限 = 已习得的最高级妖术 Lv + 2。 */
export function touhouYoujutsuCountCap(maxLevel: number): number {
  return Math.max(0, Math.floor(Number.isFinite(maxLevel) ? maxLevel : 0)) + 2;
}

/** 校验【妖术】数量是否超过「最高级 + 2」。 */
export function touhouYoujutsuCountIssue(maxLevel: number, learnedCount: number): string | null {
  const cap = touhouYoujutsuCountCap(maxLevel);
  if (Math.max(0, Math.floor(learnedCount)) > cap) {
    return `妖术总数最多为最高级 Lv+2（上限 ${cap}，当前 ${Math.floor(learnedCount)}）`;
  }
  return null;
}
