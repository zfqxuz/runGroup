import type { AbilityCategory, AbilityRules } from "./schema";

/**
 * 千幻抄能力消费表。
 *
 * costTable 是「逐级」消费：升到第 1 级花 costTable[0]，第 2 级花 costTable[1]，
 * 超出表长后固定使用最后一档（如 5/10/15/20/25/25…）。
 */
export function abilityCostForLevel(category: AbilityCategory, level: number): number {
  const target = Math.floor(level);
  if (target <= 0) return 0;
  const table = category.costTable;
  if (table.length === 0) return 0;
  const index = Math.min(target, table.length) - 1;
  return table[index] ?? 0;
}

/** 从 0 级升到 targetLevel 的累计消费点。 */
export function abilityTotalCost(category: AbilityCategory, targetLevel: number): number {
  const max = Math.max(0, Math.floor(targetLevel));
  let total = 0;
  for (let level = 1; level <= max; level += 1) {
    total += abilityCostForLevel(category, level);
  }
  return total;
}

/** 按已投入能力点推算当前可达到的最高等级。 */
export function abilityLevelForPoints(category: AbilityCategory, points: number): number {
  let remaining = Math.max(0, Math.floor(points));
  let level = 0;
  // 逐级扣费，直到点数不足下一级。
  for (;;) {
    const next = abilityCostForLevel(category, level + 1);
    if (next <= 0 || next > remaining) break;
    remaining -= next;
    level += 1;
    if (level >= 99) break;
  }
  return level;
}

/**
 * 校验某能力等级下已习得法术数是否超过类别上限。
 * spellsPerLevel=0 表示不限；否则总上限 = spellsPerLevel × 当前等级。
 */
export function abilitySpellCountIssue(
  category: AbilityCategory,
  level: number,
  learnedCount: number
): string | null {
  if (category.spellsPerLevel <= 0) return null;
  const cap = category.spellsPerLevel * Math.max(0, Math.floor(level));
  const count = Math.max(0, Math.floor(learnedCount));
  if (count > cap) {
    return `${category.name} Lv${Math.max(0, Math.floor(level))} 最多习得 ${cap} 个法术（当前 ${count}）`;
  }
  return null;
}

/** 车卡能力点预算；未知 grade 返回 null。 */
export function abilityPointBudget(rules: AbilityRules, grade: string): number | null {
  const value = rules.pointBudgets[grade];
  if (value === undefined) return null;
  return Math.max(0, Math.floor(value));
}

/** 按已习得等级计算能力点总花费。 */
export function abilitySpendTotal(
  rules: AbilityRules,
  levels: Readonly<Record<string, number>>
): number {
  let total = 0;
  for (const [categoryId, level] of Object.entries(levels)) {
    const category = rules.categories[categoryId];
    if (category === undefined) continue;
    total += abilityTotalCost(category, level);
  }
  return total;
}

export interface AbilitySpendCheck {
  readonly ok: boolean;
  readonly grade: string;
  readonly budget: number;
  readonly spent: number;
  readonly error?: string;
}

/** 校验车卡能力点：各能力等级累计消费不得超过该 grade 的预算。 */
export function validateAbilitySpend(
  rules: AbilityRules,
  grade: string,
  levels: Readonly<Record<string, number>>
): AbilitySpendCheck {
  const budget = abilityPointBudget(rules, grade);
  if (budget === null) {
    return { ok: false, grade, budget: 0, spent: 0, error: `未知的能力等级「${grade}」` };
  }
  const unknown = Object.keys(levels).filter((categoryId) => rules.categories[categoryId] === undefined);
  if (unknown.length > 0) {
    return { ok: false, grade, budget, spent: 0, error: `未知能力类别：${unknown.join("、")}` };
  }
  const spent = abilitySpendTotal(rules, levels);
  if (spent > budget) {
    return {
      ok: false,
      grade,
      budget,
      spent,
      error: `能力点超支：${grade} 级预算 ${budget} 点，已花费 ${spent} 点`
    };
  }
  return { ok: true, grade, budget, spent };
}
