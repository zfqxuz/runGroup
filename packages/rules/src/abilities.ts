import type { AbilityCategory } from "./schema";

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
