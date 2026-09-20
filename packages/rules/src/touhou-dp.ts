/**
 * 东方千幻抄 DP 模式的伤害公式与抵抗目标值。
 *
 * wiki 里的伤害写作「能力 LvD + 特性值」「锻炼 LvD + 武器 Lv」等，
 * 这里的函数把「骰数 / 固定值」结构化，再拼成战斗引擎可直接掷的表达式，
 * 便于规则层单测，也避免在战斗代码里散落字符串拼接。
 */

export interface TouhouDamageFormula {
  /** D6 骰数（LvD 的 Lv）。 */
  readonly dice: number;
  /** 固定加值（特性值、武器等级等）。 */
  readonly flat: number;
  /** 可直接交给 parseDice 的表达式，如 "3d6+55" / "55"；全 0 时为 "0"。 */
  readonly expression: string;
  /** 便于日志 / 面板展示的分解说明。 */
  readonly label: string;
}

function finiteInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function buildFormula(dice: number, flat: number, label: string): TouhouDamageFormula {
  const count = finiteInt(dice);
  const bonus = finiteInt(flat);
  const expression =
    count > 0
      ? bonus > 0
        ? count + "d6+" + bonus
        : count + "d6"
      : String(bonus);
  return { dice: count, flat: bonus, expression, label };
}

/** 能力伤害：能力 LvD + 特性值。 */
export function touhouAbilityDamage(
  attribute: number,
  abilityLevel: number,
  label = "能力 LvD + 特性"
): TouhouDamageFormula {
  return buildFormula(finiteInt(abilityLevel), finiteInt(attribute), label);
}

/** 射击伤害：能力 LvD + 特性值；使用武器技能时额外 +〈射击武器〉Lv。 */
export function touhouRangedDamage(
  attribute: number,
  abilityLevel: number,
  weaponLevel = 0,
  label = "射击 LvD + 特性 + 武器 Lv"
): TouhouDamageFormula {
  return buildFormula(finiteInt(abilityLevel), finiteInt(attribute) + finiteInt(weaponLevel), label);
}

/** 追击伤害：能力 Lv÷2 D + 特性值（向下取整）。 */
export function touhouChaseDamage(
  attribute: number,
  abilityLevel: number,
  label = "追击 Lv÷2 D + 特性"
): TouhouDamageFormula {
  return buildFormula(Math.floor(finiteInt(abilityLevel) / 2), finiteInt(attribute), label);
}

/** 近战伤害：{身体} + 锻炼 LvD + 武器 Lv。 */
export function touhouMeleeDamage(
  body: number,
  trainingLevel: number,
  weaponLevel = 0,
  label = "身体 + 锻炼 LvD + 武器 Lv"
): TouhouDamageFormula {
  return buildFormula(finiteInt(trainingLevel), finiteInt(body) + finiteInt(weaponLevel), label);
}

/**
 * 抵抗目标值 = 10 + 施术者能力 Lv + 施术者达成值×2 的十位数。
 * 施术者集中 3 分钟可让目标值 +5（更难抵抗）。
 */
export function touhouResistTargetValue(
  casterLevel: number,
  casterAchievement: number,
  concentrationBonus = 0
): number {
  return 10 + finiteInt(casterLevel) + Math.floor((finiteInt(casterAchievement) * 2) / 10) + finiteInt(concentrationBonus);
}

/** 千幻抄抵抗一次最多可用的 DP 骰：由规则包 dp.actionCosts.resistMaxDice 提供，兜底 3。 */
export const TOUHOU_RESIST_MAX_DICE_FALLBACK = 3;

/** 千幻抄能力发动 / 抵抗一次最多可用的 DP 骰：由规则包 dp.maxDicePerCheck 提供，兜底 3。 */
export const TOUHOU_MAX_DICE_PER_CHECK_FALLBACK = 3;

/** 把骰数夹到规则允许的 1..maxDicePerCheck。 */
export function clampTouhouDpDice(dice: number, maxDice = TOUHOU_MAX_DICE_PER_CHECK_FALLBACK): number {
  const max = Math.max(1, finiteInt(maxDice) || TOUHOU_MAX_DICE_PER_CHECK_FALLBACK);
  const requested = finiteInt(dice);
  return Math.max(1, Math.min(max, requested > 0 ? requested : max));
}
