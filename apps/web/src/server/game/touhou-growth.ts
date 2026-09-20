import {
  touhouAbilityGrowthCost,
  touhouAttributeGrowthCost,
  touhouGrowthGrant,
  touhouRestrictedGrowthIssue,
  touhouSkillGrowthCost,
  touhouSkillGrowthIssue,
  type AbilityRules
} from "@touhou/rules";

/** 受「单项 60%」限制的能力类别：妖术 / 锻炼（特技）。 */
export const TOUHOU_RESTRICTED_ABILITY_IDS = ["YOUJUTSU", "FEAT"] as const;

export interface TouhouGrowthPools {
  readonly granted: {
    readonly attribute: number;
    readonly skill: number;
    readonly ability: number;
    readonly hpCoefficient: number;
    readonly spellcard: number;
  };
  readonly spent: {
    readonly attribute: number;
    readonly skill: number;
    readonly ability: number;
  };
  /** 每个能力类别累计使用的成长点（用于 60% 限制）。 */
  readonly spentByAbility: Readonly<Record<string, number>>;
  /** 当前累计 HP 系数（开卡为 4）。 */
  readonly hpCoefficient: number;
  /** 当前 SC 池（小数累计；开卡为 3）。 */
  readonly spellcardPool: number;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

/** 从角色 sourceData.touhouGrowth 读取成长状态；缺省按开卡值（HP 系数 4 / SC 池 3）。 */
export function readTouhouGrowth(sourceData: unknown): TouhouGrowthPools {
  const raw = recordOf(recordOf(sourceData).touhouGrowth);
  const granted = recordOf(raw.granted);
  const spent = recordOf(raw.spent);
  const spentByAbility: Record<string, number> = {};
  for (const [key, value] of Object.entries(recordOf(raw.spentByAbility))) {
    spentByAbility[key] = nonNegative(value);
  }
  return {
    granted: {
      attribute: nonNegative(granted.attribute),
      skill: nonNegative(granted.skill),
      ability: nonNegative(granted.ability),
      hpCoefficient: nonNegative(granted.hpCoefficient),
      spellcard: nonNegative(granted.spellcard)
    },
    spent: {
      attribute: nonNegative(spent.attribute),
      skill: nonNegative(spent.skill),
      ability: nonNegative(spent.ability)
    },
    spentByAbility,
    hpCoefficient: raw.hpCoefficient === undefined ? 4 : nonNegative(raw.hpCoefficient, 4),
    spellcardPool: raw.spellcardPool === undefined ? 3 : nonNegative(raw.spellcardPool, 3)
  };
}

/** 把成长状态合并回 sourceData。 */
export function withTouhouGrowth(
  sourceData: unknown,
  pools: TouhouGrowthPools
): Record<string, unknown> {
  const base = { ...recordOf(sourceData) };
  base.touhouGrowth = {
    granted: { ...pools.granted },
    spent: { ...pools.spent },
    spentByAbility: { ...pools.spentByAbility },
    hpCoefficient: pools.hpCoefficient,
    spellcardPool: pools.spellcardPool
  };
  return base;
}

export function growthRemaining(pools: TouhouGrowthPools, key: "attribute" | "skill" | "ability"): number {
  return Math.max(0, Math.floor(pools.granted[key] - pools.spent[key]));
}

export type TouhouGrowthCheck =
  | { readonly ok: true; readonly cost: number; readonly to: number; readonly note?: string }
  | { readonly ok: false; readonly error: string };

/** 特性值成长校验：n→n+1 花 n+1 点。 */
export function checkAttributeGrowth(
  pools: TouhouGrowthPools,
  currentValue: number
): TouhouGrowthCheck {
  const from = Math.max(0, Math.floor(currentValue));
  const cost = touhouAttributeGrowthCost(from, from + 1);
  if (cost > growthRemaining(pools, "attribute")) {
    return { ok: false, error: `特性值成长需要 ${cost} 点，剩余 ${growthRemaining(pools, "attribute")} 点` };
  }
  return { ok: true, cost, to: from + 1 };
}

/** 技能成长校验：一次最多 1 级，消费表 1/2/3/4/5…。 */
export function checkSkillGrowth(pools: TouhouGrowthPools, currentLevel: number): TouhouGrowthCheck {
  const from = Math.max(0, Math.floor(currentLevel));
  const issue = touhouSkillGrowthIssue(from, from + 1);
  if (issue !== null) return { ok: false, error: issue };
  const cost = touhouSkillGrowthCost(from, from + 1);
  if (cost > growthRemaining(pools, "skill")) {
    return { ok: false, error: `技能成长需要 ${cost} 点，剩余 ${growthRemaining(pools, "skill")} 点` };
  }
  return { ok: true, cost, to: from + 1 };
}

/** 能力成长校验：与开卡同一消费表；妖术 / 锻炼受单项 60% 限制。 */
export function checkAbilityGrowth(
  rules: AbilityRules,
  pools: TouhouGrowthPools,
  categoryId: string,
  currentLevel: number
): TouhouGrowthCheck {
  const category = rules.categories[categoryId];
  if (category === undefined) return { ok: false, error: "未知能力类别：" + categoryId };
  const from = Math.max(0, Math.floor(currentLevel));
  const cost = touhouAbilityGrowthCost(category, from, from + 1);
  if (cost > growthRemaining(pools, "ability")) {
    return { ok: false, error: `能力成长需要 ${cost} 点，剩余 ${growthRemaining(pools, "ability")} 点` };
  }
  if ((TOUHOU_RESTRICTED_ABILITY_IDS as readonly string[]).includes(categoryId)) {
    const spentOnAbility = Math.floor(pools.spentByAbility[categoryId] ?? 0) + cost;
    const issue = touhouRestrictedGrowthIssue(pools.granted.ability, spentOnAbility);
    if (issue !== null) return { ok: false, error: issue };
  }
  return { ok: true, cost, to: from + 1 };
}

export interface TouhouGrowthGrantPreview {
  readonly attribute: number;
  readonly skill: number;
  readonly ability: number;
  readonly hpCoefficient: number;
  readonly spellcard: number;
}

/** KP 4 个等级的成长量预览；任一等级非法返回 null。 */
export function previewGrowthGrant(
  rules: AbilityRules,
  grades: { attribute: string; skill: string; ability: string; hpSpellcard: string }
): TouhouGrowthGrantPreview | null {
  const grant = touhouGrowthGrant(rules, grades);
  if (grant === null) return null;
  return grant;
}
