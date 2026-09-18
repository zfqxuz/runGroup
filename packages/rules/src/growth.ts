import { rollDie, type Rng } from "@touhou/formula";

/**
 * CoC 7e 幕间成长检定。
 *
 * 规则：
 * - 对每个本局使用成功并标记的技能掷 1d100；
 * - 若结果大于当前技能值，技能成长 1d10；
 * - 完整版 7e 额外允许 96–100 必定成长（可由规则包关闭，用于入门版规则）。
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

export interface GrowthCheckOptions {
  /** 完整版 7e 默认 true；入门版规则可设为 false。 */
  readonly autoPassFrom96?: boolean;
}

export function isGrowthCheckPassed(
  roll: number,
  beforeValue: number,
  autoPassFrom96 = true
): boolean {
  return roll > beforeValue || (autoPassFrom96 && roll >= 96);
}

export function resolveGrowthChecks(
  checks: readonly GrowthCheckInput[],
  rng: Rng,
  options: GrowthCheckOptions = {}
): GrowthCheckResult[] {
  const autoPassFrom96 = options.autoPassFrom96 ?? true;
  const results: GrowthCheckResult[] = [];
  for (const check of checks) {
    const roll = rollDie(rng, 100);
    const passed = isGrowthCheckPassed(roll, check.beforeValue, autoPassFrom96);
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
