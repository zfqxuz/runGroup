import { compile, evaluate } from "@touhou/formula";
import type {
  AbilityCategory,
  AbilityDefinition,
  AbilityPassive,
  AbilityRules,
  AbilityVariant,
  Race
} from "./schema";

/**
 * 解析能力实例 id。
 *
 * 属性使等能力「每种属性独立」，用 `CATEGORY:SUFFIX` 表示实例
 * （例如 `ELEMENTALIST:FIRE`）；没有冒号时 suffix 为 null，表示整类能力。
 */
export function splitAbilityInstanceId(id: string): { readonly categoryId: string; readonly suffix: string | null } {
  const index = id.indexOf(":");
  if (index <= 0 || index >= id.length - 1) return { categoryId: id, suffix: null };
  return { categoryId: id.slice(0, index), suffix: id.slice(index + 1) };
}

/**
 * 解析能力变体 id。
 *
 * 同一类别可以有多个替代习得路径，用 `CATEGORY#VARIANT` 表示
 * （例如 `SPIRIT_ARTS#UTSUSHI` 术式版、`YOUJUTSU#DANMAKU` 妖弹化）；
 * 没有 `#` 时 variantId 为 null，表示基础路径。
 */
export function splitAbilityVariantId(id: string): { readonly baseId: string; readonly variantId: string | null } {
  const index = id.indexOf("#");
  if (index <= 0 || index >= id.length - 1) return { baseId: id, variantId: null };
  return { baseId: id.slice(0, index), variantId: id.slice(index + 1) };
}

/** 按实例 id 找到能力类别；先精确匹配，再退回冒号前的类别。 */
export function resolveAbilityCategory(rules: AbilityRules, id: string): AbilityCategory | undefined {
  const { baseId } = splitAbilityVariantId(id);
  return rules.categories[baseId] ?? rules.categories[splitAbilityInstanceId(baseId).categoryId];
}

/** 按实例 id 找到能力变体；没有变体或类别不存在时返回 undefined。 */
export function resolveAbilityVariant(rules: AbilityRules, id: string): AbilityVariant | undefined {
  const category = resolveAbilityCategory(rules, id);
  if (category === undefined) return undefined;
  const { variantId } = splitAbilityVariantId(id);
  if (variantId === null) return undefined;
  return category.variants[variantId];
}

/** 取某实例使用的消费表（有变体用变体表，否则用类别基础表）。 */
function costTableFor(category: AbilityCategory, variantId?: string | null): readonly number[] {
  if (variantId === null || variantId === undefined) return category.costTable;
  return category.variants[variantId]?.costTable ?? category.costTable;
}

/**
 * 千幻抄能力消费表。
 *
 * costTable 是「逐级」消费：升到第 1 级花 costTable[0]，第 2 级花 costTable[1]，
 * 超出表长后固定使用最后一档（如 5/10/15/20/25/25…）。
 * 传入 variantId 时使用对应变体表（如术式版 3/6/9/12/15/15…）。
 */
export function abilityCostForLevel(category: AbilityCategory, level: number, variantId?: string | null): number {
  const target = Math.floor(level);
  if (target <= 0) return 0;
  const table = costTableFor(category, variantId);
  if (table.length === 0) return 0;
  const index = Math.min(target, table.length) - 1;
  return table[index] ?? 0;
}

/** 从 0 级升到 targetLevel 的累计消费点。 */
export function abilityTotalCost(
  category: AbilityCategory,
  targetLevel: number,
  variantId?: string | null
): number {
  const max = Math.max(0, Math.floor(targetLevel));
  let total = 0;
  for (let level = 1; level <= max; level += 1) {
    total += abilityCostForLevel(category, level, variantId);
  }
  return total;
}

/** 按已投入能力点推算当前可达到的最高等级。 */
export function abilityLevelForPoints(
  category: AbilityCategory,
  points: number,
  variantId?: string | null
): number {
  let remaining = Math.max(0, Math.floor(points));
  let level = 0;
  // 逐级扣费，直到点数不足下一级。
  for (;;) {
    const next = abilityCostForLevel(category, level + 1, variantId);
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

/** 类别在 levels 中的有效等级：取所有同类别实例（含变体）的最高值。 */
export function abilityCategoryLevelFromLevels(
  levels: Readonly<Record<string, number>>,
  categoryId: string
): number {
  let best = 0;
  for (const [instanceId, rawLevel] of Object.entries(levels)) {
    const category = resolveAbilityCategory(
      { enabled: true, categories: { [categoryId]: dummyCategory(categoryId) }, pointBudgets: {}, growthRanks: {}, definitions: {} },
      instanceId
    );
    if (category === undefined) continue;
    if (category.id !== categoryId) continue;
    best = Math.max(best, Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 0);
  }
  return best;
}

function dummyCategory(id: string): AbilityCategory {
  return { id, name: id, activationAttribute: "int", costTable: [0], spellsPerLevel: 0, variants: {} };
}

/** 按已习得等级计算能力点总花费（支持变体与属性使实例）。 */
export function abilitySpendTotal(
  rules: AbilityRules,
  levels: Readonly<Record<string, number>>
): number {
  let total = 0;
  for (const [instanceId, level] of Object.entries(levels)) {
    const category = resolveAbilityCategory(rules, instanceId);
    if (category === undefined) continue;
    const { variantId } = splitAbilityVariantId(instanceId);
    total += abilityTotalCost(category, level, variantId);
  }
  return total;
}

/** 具体能力条目的单级消费：costPerLevel 优先，否则固定 cost（仅 1 级）。 */
export function abilityDefinitionStepCost(definition: AbilityDefinition, level: number): number {
  const lv = Math.max(1, Math.floor(level));
  if (definition.costPerLevel !== undefined) {
    try {
      const compiled = compile(definition.costPerLevel, { vars: ["level"], consts: [] });
      const value = evaluate(compiled, { vars: { level: lv }, consts: {} });
      return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    } catch {
      return 0;
    }
  }
  return lv === 1 ? Math.max(0, Math.floor(definition.cost ?? 0)) : 0;
}

/** 从 0 级到 targetLevel 的具体能力条目累计消费。 */
export function abilityDefinitionTotalCost(definition: AbilityDefinition, targetLevel: number): number {
  const max = Math.max(0, Math.floor(targetLevel));
  if (definition.costPerLevel === undefined) {
    return max > 0 ? Math.max(0, Math.floor(definition.cost ?? 0)) : 0;
  }
  let total = 0;
  for (let level = 1; level <= max; level += 1) total += abilityDefinitionStepCost(definition, level);
  return total;
}

/** 已习得具体能力条目的累计消费：id -> Lv。 */
export function abilityDefinitionSpendTotal(
  rules: AbilityRules,
  definitionLevels: Readonly<Record<string, number>>
): number {
  let total = 0;
  for (const [definitionId, rawLevel] of Object.entries(definitionLevels)) {
    const definition = rules.definitions[definitionId];
    if (definition === undefined) continue;
    total += abilityDefinitionTotalCost(definition, rawLevel);
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

export interface AbilitySpendOptions {
  /** 角色种族；用于校验种族禁止的能力类别。 */
  readonly race?: Race | null;
  /** 属性使组合例外：允许人类通过属性使路径接触妖术 / 妖力。 */
  readonly allowElementalistException?: boolean;
  /** 已习得的具体能力条目等级：id -> Lv（妖力 / 特技）。 */
  readonly definitionLevels?: Readonly<Record<string, number>>;
}

/** 校验车卡能力点：各能力等级累计消费不得超过该 grade 的预算。 */
export function validateAbilitySpend(
  rules: AbilityRules,
  grade: string,
  levels: Readonly<Record<string, number>>,
  options: AbilitySpendOptions = {}
): AbilitySpendCheck {
  const budget = abilityPointBudget(rules, grade);
  if (budget === null) {
    return { ok: false, grade, budget: 0, spent: 0, error: `未知的能力等级「${grade}」` };
  }
  const unknown: string[] = [];
  const forbidden: string[] = [];
  for (const definitionId of Object.keys(options.definitionLevels ?? {})) {
    if (rules.definitions[definitionId] === undefined) unknown.push(definitionId);
  }
  const spent =
    abilitySpendTotal(rules, levels) +
    abilityDefinitionSpendTotal(rules, options.definitionLevels ?? {});
  for (const instanceId of Object.keys(levels)) {
    const category = resolveAbilityCategory(rules, instanceId);
    if (category === undefined) {
      unknown.push(instanceId);
      continue;
    }
    const { variantId } = splitAbilityVariantId(instanceId);
    if (variantId !== null && category.variants[variantId] === undefined) {
      unknown.push(instanceId);
      continue;
    }
    if (
      options.race !== null &&
      options.race !== undefined &&
      options.race.disallowedAbilityCategories.includes(category.id) &&
      options.allowElementalistException !== true
    ) {
      forbidden.push(category.name);
    }
  }
  if (unknown.length > 0) {
    return { ok: false, grade, budget, spent: 0, error: `未知能力类别：${unknown.join("、")}` };
  }
  if (forbidden.length > 0) {
    return {
      ok: false,
      grade,
      budget,
      spent: 0,
      error: `${options.race?.name ?? "该种族"}不能习得：${[...new Set(forbidden)].join("、")}`
    };
  }
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

/** 合并角色已投入等级与种族免费等级；同类别取较高者。 */
export function effectiveAbilityLevels(
  levels: Readonly<Record<string, number>>,
  race?: Race | null
): Record<string, number> {
  const merged: Record<string, number> = { ...levels };
  if (race === null || race === undefined) return merged;
  for (const [categoryId, freeLevel] of Object.entries(race.freeAbilityLevels)) {
    const current = abilityCategoryLevelFromLevels(merged, categoryId);
    if (freeLevel > current) merged[categoryId] = freeLevel;
  }
  return merged;
}

/** 某能力类别是否允许该种族习得（属性使组合例外由调用方传 allowException）。 */
export function abilityCategoryAllowedForRace(
  race: Race | null | undefined,
  categoryId: string,
  allowElementalistException = false
): boolean {
  if (race === null || race === undefined) return true;
  if (allowElementalistException && categoryId === "ELEMENTALIST") return true;
  return !race.disallowedAbilityCategories.includes(categoryId);
}

export interface AbilityPassiveInput {
  /** 角色有效能力等级（建议先经过 effectiveAbilityLevels）。 */
  readonly abilityLevels: Readonly<Record<string, number>>;
  /** 已习得的具体能力条目 id（按 1 级处理）；与 definitionLevels 二选一。 */
  readonly definitionIds?: readonly string[];
  /** 已习得的具体能力条目等级：id -> Lv（妖力 / 特技可多级）。 */
  readonly definitionLevels?: Readonly<Record<string, number>>;
  /** 规则包常量（可选，供被动表达式引用）。 */
  readonly constants?: Readonly<Record<string, number>>;
}

export interface AbilityPassiveMods {
  readonly attributeMods: Readonly<Record<string, number>>;
  readonly skillMods: Readonly<Record<string, number>>;
  readonly derivedMods: Readonly<Record<string, number>>;
  readonly damageBonus: number;
  readonly reactionBonus: number;
  readonly accuracyBonus: number;
  readonly movementBonus: number;
  /** 每 N 点擦弹额外 +1；0 表示不生效。 */
  readonly grazeBonusPer: number;
  /** 受到弹幕攻击时的 DP 减少值减免。 */
  readonly danmakuDpReduction: number;
  /** 受到弹幕攻击时的固定伤害减免。 */
  readonly danmakuDamageReduction: number;
  readonly sources: readonly string[];
}

function emptyPassiveMods(): {
  attributeMods: Record<string, number>;
  skillMods: Record<string, number>;
  derivedMods: Record<string, number>;
  damageBonus: number;
  reactionBonus: number;
  accuracyBonus: number;
  movementBonus: number;
  grazeBonusPer: number;
  danmakuDpReduction: number;
  danmakuDamageReduction: number;
  sources: string[];
} {
  return {
    attributeMods: {},
    skillMods: {},
    derivedMods: {},
    damageBonus: 0,
    reactionBonus: 0,
    accuracyBonus: 0,
    movementBonus: 0,
    grazeBonusPer: 0,
    danmakuDpReduction: 0,
    danmakuDamageReduction: 0,
    sources: []
  };
}

function evalPassiveExpr(
  source: string,
  abilityLv: number,
  constants: Readonly<Record<string, number>>
): number {
  const compiled = compile(source, { vars: ["abilityLv"], consts: Object.keys(constants) });
  const value = evaluate(compiled, { vars: { abilityLv }, consts: constants });
  return Number.isFinite(value) ? value : 0;
}

function applyPassive(
  passive: AbilityPassive,
  abilityLv: number,
  constants: Readonly<Record<string, number>>,
  mods: ReturnType<typeof emptyPassiveMods>,
  sourceId: string
): void {
  for (const [key, expr] of Object.entries(passive.attributeMods)) {
    mods.attributeMods[key] = (mods.attributeMods[key] ?? 0) + evalPassiveExpr(expr, abilityLv, constants);
  }
  for (const [key, expr] of Object.entries(passive.skillMods)) {
    mods.skillMods[key] = (mods.skillMods[key] ?? 0) + evalPassiveExpr(expr, abilityLv, constants);
  }
  for (const [key, expr] of Object.entries(passive.derivedMods)) {
    mods.derivedMods[key] = (mods.derivedMods[key] ?? 0) + evalPassiveExpr(expr, abilityLv, constants);
  }
  mods.damageBonus += evalPassiveExpr(passive.damageBonus, abilityLv, constants);
  mods.reactionBonus += evalPassiveExpr(passive.reactionBonus, abilityLv, constants);
  mods.accuracyBonus += evalPassiveExpr(passive.accuracyBonus, abilityLv, constants);
  mods.movementBonus += evalPassiveExpr(passive.movementBonus, abilityLv, constants);
  mods.grazeBonusPer = Math.max(mods.grazeBonusPer, passive.grazeBonusPer);
  mods.danmakuDpReduction = Math.max(mods.danmakuDpReduction, passive.danmakuDpReduction);
  mods.danmakuDamageReduction = Math.max(mods.danmakuDamageReduction, passive.danmakuDamageReduction);
  mods.sources.push(sourceId);
}

/**
 * 汇总角色已习得能力条目的常时被动。
 *
 * 只处理 `kind !== "ACTIVE"` 且角色能力等级达到 `minLevel` 的条目；
 * 表达式可引用 `abilityLv`（该条目所属类别的有效等级）。
 */
export function collectAbilityPassiveMods(
  rules: AbilityRules,
  input: AbilityPassiveInput
): AbilityPassiveMods {
  const mods = emptyPassiveMods();
  const constants = input.constants ?? {};
  const explicit = input.definitionLevels ?? {};
  const owned = new Set<string>([...Object.keys(explicit), ...(input.definitionIds ?? [])]);
  for (const definitionId of owned) {
    const definition: AbilityDefinition | undefined = rules.definitions[definitionId];
    if (definition === undefined || definition.kind === "ACTIVE") continue;
    // 显式等级优先；只给 definitionIds 时退回该条目所属类别的等级（兼容旧调用）。
    const explicitLevel = explicit[definitionId];
    const categoryLevel = Math.max(1, abilityCategoryLevelFromLevels(input.abilityLevels, definition.categoryId));
    const level = Math.max(
      1,
      Math.floor(Number.isFinite(explicitLevel) ? (explicitLevel as number) : categoryLevel)
    );
    if (level < definition.minLevel) continue;
    for (const passive of definition.passives) {
      applyPassive(passive, level, constants, mods, definition.id);
    }
  }
  return mods;
}

/** 应用被动修回到一组属性 / 技能 / 衍生值上（就地返回新对象）。 */
export function applyAbilityPassiveMods<T extends {
  attributes: Record<string, number>;
  skills: Record<string, number>;
  derived: Record<string, number>;
}>(
  target: T,
  mods: AbilityPassiveMods
): T {
  const attributes = { ...target.attributes };
  for (const [key, value] of Object.entries(mods.attributeMods)) {
    attributes[key] = Math.max(0, (attributes[key] ?? 0) + value);
  }
  const skills = { ...target.skills };
  for (const [key, value] of Object.entries(mods.skillMods)) {
    skills[key] = Math.max(0, (skills[key] ?? 0) + value);
  }
  const derived = { ...target.derived };
  for (const [key, value] of Object.entries(mods.derivedMods)) {
    derived[key] = Math.max(0, (derived[key] ?? 0) + value);
  }
  return { ...target, attributes, skills, derived };
}

/** 供 UI 展示：某定义在给定等级下是否已解锁。 */
export function abilityDefinitionUnlocked(
  definition: AbilityDefinition,
  abilityLevels: Readonly<Record<string, number>>,
  ownedDefinitionIds: readonly string[] = []
): boolean {
  if (definition.kind === "FREE") return true;
  const level = abilityCategoryLevelFromLevels(abilityLevels, definition.categoryId);
  if (level < definition.minLevel) return false;
  if (definition.kind === "ACTIVE") return ownedDefinitionIds.includes(definition.id);
  return true;
}
