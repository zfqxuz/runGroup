import { rollDie, type Rng } from "@touhou/formula";

/**
 * CoC 7e 幕间成长检定。
 *
 * 规则：对每个本局使用成功并标记的技能掷 1d100；
 * 若结果大于当前技能值，或结果落在 96-100，则技能成长 1d10。
 * 大成功 / 大失败不额外处理，保持规则原样。
 */
export interface GrowthCheckInput {
  readonly id: string;
  readonly skillId: string;
  readonly beforeValue: number;
}

export interface GrowthCheckResult {
  readonly id: string;
  readonly skillId: string;
  readonly beforeValue: number;
  readonly roll: number;
  readonly passed: boolean;
  readonly gain: number;
}

export function isGrowthCheckPassed(roll: number, beforeValue: number): boolean {
  return roll > beforeValue || roll >= 96;
}

export function resolveGrowthChecks(
  checks: readonly GrowthCheckInput[],
  rng: Rng
): GrowthCheckResult[] {
  const results: GrowthCheckResult[] = [];
  for (const check of checks) {
    const roll = rollDie(rng, 100);
    const passed = isGrowthCheckPassed(roll, check.beforeValue);
    const gain = passed ? rollDie(rng, 10) : 0;
    results.push({
      id: check.id,
      skillId: check.skillId,
      beforeValue: check.beforeValue,
      roll,
      passed,
      gain
    });
  }
  return results;
}
