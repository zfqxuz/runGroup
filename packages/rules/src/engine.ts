import { evaluate, type CompiledExpr, type EvalContext } from "@touhou/formula";
import type { CompiledRace, CompiledRulePack } from "./compile";
import { RulePackError } from "./errors";
import {
  ATTRIBUTE_KEYS,
  CHECK_RANK,
  DERIVED_KEYS,
  type AttributeSet,
  type CheckResult,
  type DerivedStats
} from "./types";

export interface DerivedInput {
  readonly attributes: AttributeSet;
  readonly race?: string | null;
  /**
   * 用于衍生公式的技能值。
   * 目前 COC7 的 maxSan = 99 - CTHULHU_MYTHOS 会读取 CTHULHU_MYTHOS；
   * 未传时默认视为 0，保证旧调用方仍可工作。
   */
  readonly skills?: Readonly<Record<string, number>>;
}

export interface DerivedOutcome {
  readonly race: string | null;
  readonly attributes: AttributeSet;
  readonly derived: DerivedStats;
  readonly flags: readonly string[];
  readonly skillBonuses: Readonly<Record<string, number>>;
}

export interface CheckOutcome {
  readonly roll: number;
  readonly target: number;
  readonly result: CheckResult;
  readonly rank: number;
}

function evalIn(
  pack: CompiledRulePack,
  expression: CompiledExpr,
  vars: Readonly<Record<string, number>>
): number {
  const context: EvalContext = { vars, consts: pack.pack.const };
  return evaluate(expression, context);
}

/**
 * 计算角色的有效属性与衍生属性。
 *
 * 顺序：种族属性修正 -> 基础衍生公式（拓扑序）-> 种族衍生增量。
 * 种族不直接改写公式，而是提供「增量」，这样公式命名空间始终是封闭的，
 * 任何拼写错误都会在加载配置时被 formula 引擎拦下。
 */
export function computeDerived(
  pack: CompiledRulePack,
  input: DerivedInput
): DerivedOutcome {
  const raceKey = input.race ?? null;
  let race: CompiledRace | null = null;

  if (raceKey !== null) {
    race = pack.races[raceKey] ?? null;
    if (race === null) {
      throw new RulePackError("RACE_UNKNOWN", `RulePack "${pack.id}" 未定义种族 "${raceKey}"`, {
        race: raceKey,
        available: Object.keys(pack.races)
      });
    }
  }

  const attrs: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) attrs[key] = input.attributes[key];

  if (race !== null) {
    for (const [key, expression] of Object.entries(race.attrMods)) {
      attrs[key] = (attrs[key] ?? 0) + evalIn(pack, expression, attrs);
    }
  }

  const skillVars: Record<string, number> = {
    CTHULHU_MYTHOS: 0,
    ...(input.skills ?? {})
  };

  const derived: Record<string, number> = {};
  for (const key of pack.derivedOrder) {
    const expression = pack.derived[key];
    if (expression === undefined) continue;
    derived[key] = evalIn(pack, expression, { ...skillVars, ...attrs, ...derived });
  }

  if (race !== null) {
    const base: Record<string, number> = { ...skillVars, ...attrs, ...derived };
    for (const [key, expression] of Object.entries(race.derivedOverrides)) {
      derived[key] = (derived[key] ?? 0) + evalIn(pack, expression, base);
    }
  }

  const skillBonuses: Record<string, number> = {};
  if (race !== null) {
    for (const [key, expression] of Object.entries(race.skillBonuses)) {
      skillBonuses[key] = evalIn(pack, expression, attrs);
    }
  }

  const stats = {} as Record<string, number>;
  for (const key of DERIVED_KEYS) stats[key] = Math.floor(derived[key] ?? 0);

  const safeAttributes = {} as Record<string, number>;
  for (const key of ATTRIBUTE_KEYS) safeAttributes[key] = Math.floor(attrs[key] ?? 0);

  return {
    race: raceKey,
    attributes: safeAttributes as unknown as AttributeSet,
    derived: stats as unknown as DerivedStats,
    flags: race?.flags ?? [],
    skillBonuses
  };
}

export function isSuccess(result: CheckResult): boolean {
  return result === "REGULAR" || result === "HARD" || result === "EXTREME" || result === "CRITICAL";
}

/**
 * COC7 判定。判定顺序固定，且必须与配置里的阈值一致：
 *   CRITICAL -> EXTREME -> HARD -> REGULAR -> FUMBLE -> FAIL
 *
 * 边界（都有单测）：
 *  - target <= 0 直接 FAIL，避免进入除数分支
 *  - target >= 100 时不再可能出现大失败（100 视为普通成功）
 */
export function resolveCheck(
  pack: CompiledRulePack,
  roll: number,
  target: number
): CheckOutcome {
  const vars = { roll, target };
  const criticalAt = evalIn(pack, pack.check.criticalAt as CompiledExpr, vars);
  const extremeDivisor = evalIn(pack, pack.check.extremeDivisor as CompiledExpr, vars);
  const hardDivisor = evalIn(pack, pack.check.hardDivisor as CompiledExpr, vars);
  const fumbleFlat = evalIn(pack, pack.check.fumbleFlat as CompiledExpr, vars);
  const fumbleSkillBelow = evalIn(pack, pack.check.fumbleSkillBelow as CompiledExpr, vars);
  const fumbleRangeFrom = evalIn(pack, pack.check.fumbleRangeFrom as CompiledExpr, vars);

  const effectiveTarget = Math.floor(target);
  const make = (result: CheckResult): CheckOutcome => ({
    roll,
    target: effectiveTarget,
    result,
    rank: CHECK_RANK[result]
  });

  if (effectiveTarget <= 0) return make("FAIL");
  if (roll <= criticalAt) return make("CRITICAL");
  if (roll <= Math.floor(effectiveTarget / extremeDivisor)) return make("EXTREME");
  if (roll <= Math.floor(effectiveTarget / hardDivisor)) return make("HARD");
  if (roll <= effectiveTarget) return make("REGULAR");
  if (effectiveTarget < fumbleSkillBelow && roll >= fumbleRangeFrom) return make("FUMBLE");
  if (roll >= fumbleFlat) return make("FUMBLE");
  return make("FAIL");
}

/** 对抗检定：先比成功等级，同级时比技能值，再同级比先攻属性。 */
export function resolveOpposed(
  pack: CompiledRulePack,
  attacker: { roll: number; target: number },
  defender: { roll: number; target: number }
): { winner: "ATTACKER" | "DEFENDER" | "TIE"; attacker: CheckOutcome; defender: CheckOutcome } {
  const a = resolveCheck(pack, attacker.roll, attacker.target);
  const b = resolveCheck(pack, defender.roll, defender.target);

  if (a.rank > b.rank) return { winner: "ATTACKER", attacker: a, defender: b };
  if (b.rank > a.rank) return { winner: "DEFENDER", attacker: a, defender: b };
  if (a.target > b.target) return { winner: "ATTACKER", attacker: a, defender: b };
  if (b.target > a.target) return { winner: "DEFENDER", attacker: a, defender: b };
  return { winner: "TIE", attacker: a, defender: b };
}
