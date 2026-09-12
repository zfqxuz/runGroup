import { evaluate, type EvalContext } from "@touhou/formula";
import type { CompiledRulePack } from "./compile";
import type { DefenseType } from "./types";

export interface DamageInput {
  readonly baseDamage: number;
  readonly defense: DefenseType;
  readonly defenseSuccess?: boolean;
  readonly spellcardMultiplier?: number;
  readonly enhanceFlat?: number;
  readonly shieldMultiplier?: number;
  readonly vars?: Readonly<Record<string, number>>;
}

export interface DamageOutcome {
  readonly damage: number;
  readonly mpCost: number;
  readonly mpGained: number;
  /** 实际执行过的管线步骤，按顺序。可直接写进战斗日志供仲裁。 */
  readonly steps: readonly string[];
}

/**
 * 伤害管线。结算顺序完全由 RulePack 的 damage.pipeline 决定，
 * 代码只负责实现每个步骤的语义，不假设顺序。
 *
 * 这样改平衡（例如「防御改成先减免再乘倍率」）不需要改代码。
 */
export function applyDamagePipeline(
  pack: CompiledRulePack,
  input: DamageInput
): DamageOutcome {
  const vars = input.vars ?? {};
  const context: EvalContext = { vars, consts: pack.pack.const };
  const steps: string[] = [];

  let damage = input.baseDamage;
  let mpCost = 0;
  let mpGained = 0;

  const costOf = (expression: Parameters<typeof evaluate>[0]): number =>
    Math.max(0, Math.floor(evaluate(expression, context)));

  for (const step of pack.damage.pipeline) {
    switch (step) {
      case "BASE_DICE": {
        steps.push(`base=${damage}`);
        break;
      }
      case "SPELLCARD_MULT": {
        const multiplier = input.spellcardMultiplier;
        if (multiplier !== undefined) {
          damage *= multiplier;
          steps.push(`spellcard x${multiplier} -> ${damage}`);
        }
        break;
      }
      case "ENHANCE_MOD": {
        const flat = input.enhanceFlat;
        if (flat !== undefined) {
          damage += flat;
          steps.push(`enhance ${flat >= 0 ? "+" : ""}${flat} -> ${damage}`);
        }
        break;
      }
      case "DEFEND_REDUCE": {
        if (input.defense !== "DEFEND") break;
        const cost = costOf(pack.damage.defend.cost);
        const multiplier = evaluate(pack.damage.defend.reduceMultiplier, context);
        const reduction = cost * multiplier;
        mpCost += cost;
        damage -= reduction;
        steps.push(`defend -${reduction} (mp ${cost}) -> ${damage}`);
        break;
      }
      case "COUNTER_RESOLVE": {
        if (input.defense !== "COUNTER") break;
        const cost = costOf(pack.damage.counter.cost);
        mpCost += cost;
        if (input.defenseSuccess === true) {
          steps.push(`counter success (mp ${cost}) -> 0`);
          damage = 0;
        } else {
          const ratio = evaluate(pack.damage.counter.failDamageRatio, context);
          damage *= ratio;
          steps.push(`counter fail x${ratio} (mp ${cost}) -> ${damage}`);
        }
        break;
      }
      case "GRAZE_RESOLVE": {
        if (input.defense !== "DODGE") break;
        const cost = costOf(pack.damage.dodge.cost);
        mpCost += cost;
        if (input.defenseSuccess === true) {
          const ratio = evaluate(pack.damage.dodge.grazeMpGainRatio, context);
          mpGained += Math.max(0, Math.floor(Math.max(0, damage) * ratio));
          steps.push(`graze success (mp ${cost}) -> 0, gain ${mpGained}`);
          damage = 0;
        } else {
          steps.push(`graze fail (mp ${cost}) -> ${damage}`);
        }
        break;
      }
      case "SHIELD_REDUCE": {
        const multiplier = input.shieldMultiplier;
        if (multiplier !== undefined) {
          damage *= multiplier;
          steps.push(`shield x${multiplier} -> ${damage}`);
        }
        break;
      }
      case "CLAMP_MIN_ZERO": {
        damage = Math.max(0, damage);
        steps.push(`clamp -> ${damage}`);
        break;
      }
    }
  }

  const floored = Math.max(0, Math.floor(damage));
  // 伤害被防御/减伤压到 (0,1) 之间时，按至少 1 点结算；完全免伤（0）仍为 0。
  const finalDamage = damage > 0 && floored === 0 ? 1 : floored;
  return { damage: finalDamage, mpCost, mpGained, steps };
}
