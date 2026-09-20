import { compile as compileExpr, evaluate } from "@touhou/formula";
import type { CompiledRulePack } from "./compile";
import type { DpActionCosts } from "./schema";

export interface DpEconomyInput {
  readonly dpMax: number;
  readonly dpRegen: number;
  readonly mp: number;
  readonly actionCosts: DpActionCosts;
  /** 一次能力发动的平均灵力消耗；默认 15。 */
  readonly averageAbilityMpCost?: number;
  /** 计算「一次判定用几颗骰」的参考值；默认 3（能力 / 抵抗上限）。 */
  readonly dicePerCheck?: number;
}

export interface DpEconomySummary {
  /** 每回合能打几次弹幕（固定 DP 消耗）。 */
  readonly danmakuPerRound: number;
  /** 一场战斗（满 DP）能打几次弹幕。 */
  readonly danmakuPerBattle: number;
  /** 每回合能做几次 3D 骰的射击 / 回避 / 防御判定。 */
  readonly rangedChecksPerRound: number;
  readonly dodgeChecksPerRound: number;
  readonly defendChecksPerRound: number;
  /** 每回合能完成几次「接近 + 命中」近战（各 3D 参考）。 */
  readonly meleeChecksPerRound: number;
  /** 每回合能用追击打几个目标（目标数 × 每目标消耗）。 */
  readonly chaseTargetsPerRound: number;
  /** 以平均消耗计，一份 MP 能放几次能力。 */
  readonly abilityCastsPerMp: number;
  /** 参考值：单次 3D 判定、单次弹幕、单目标追击的 DP 消耗。 */
  readonly referenceCosts: {
    readonly danmaku: number;
    readonly check3d: number;
    readonly melee: number;
    readonly chaseOneTarget: number;
  };
}

function safeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function perRound(budget: number, cost: number): number {
  if (cost <= 0) return 0;
  return Math.floor(budget / cost);
}

/**
 * 千幻抄 DP / MP 资源经济换算。
 *
 * 输入一组属性对应的 DP 上限、DP 回复与 MP，按规则包的可配置消耗，
 * 估算「每回合能行动几次 / 一场战斗能打几次 / 能放几次能力」。
 * 该函数同时用于验证 DP 消耗配置是否合理。
 */
export function dpEconomySummary(input: DpEconomyInput): DpEconomySummary {
  const dpMax = safeInt(input.dpMax);
  const dpRegen = safeInt(input.dpRegen);
  const mp = safeInt(input.mp);
  const dice = Math.max(1, safeInt(input.dicePerCheck ?? 3));
  const costs = input.actionCosts;
  const averageAbilityMpCost = Math.max(1, safeInt(input.averageAbilityMpCost ?? 15));

  const rangedPerDie = safeInt(costs.rangedPerDie);
  const dodgePerDie = safeInt(costs.dodgePerDie);
  const defendPerDie = safeInt(costs.defendPerDie);
  const meleeCost = (safeInt(costs.meleeApproachPerDie) + safeInt(costs.meleeHitPerDie)) * dice;

  return {
    danmakuPerRound: perRound(dpRegen, safeInt(costs.danmaku)),
    danmakuPerBattle: perRound(dpMax, safeInt(costs.danmaku)),
    rangedChecksPerRound: perRound(dpRegen, rangedPerDie * dice),
    dodgeChecksPerRound: perRound(dpRegen, dodgePerDie * dice),
    defendChecksPerRound: perRound(dpRegen, defendPerDie * dice),
    meleeChecksPerRound: perRound(dpRegen, meleeCost),
    chaseTargetsPerRound: perRound(dpRegen, safeInt(costs.chasePerTarget)),
    abilityCastsPerMp: Math.floor(mp / averageAbilityMpCost),
    referenceCosts: {
      danmaku: safeInt(costs.danmaku),
      check3d: rangedPerDie * dice,
      melee: meleeCost,
      chaseOneTarget: safeInt(costs.chasePerTarget)
    }
  };
}

/** 按当前规则包（含房间覆盖）计算某属性集下的 DP 回复；供 KP 试算使用。 */
export function dpRegenFromVars(
  compiled: CompiledRulePack,
  vars: Readonly<Record<string, number>>
): number {
  const rules = compiled.pack.dp;
  try {
    const expression = compileExpr(rules.regen, {
      vars: Object.keys(vars),
      consts: compiled.constantNames
    });
    const value = evaluate(expression, { vars, consts: compiled.pack.const });
    return Math.max(rules.minRegen, Number.isFinite(value) ? Math.floor(value) : rules.minRegen);
  } catch {
    return rules.minRegen;
  }
}
