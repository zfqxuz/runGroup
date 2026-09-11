import { describe, expect, it } from "vitest";
import { createSeededRng, rollDie } from "@touhou/formula";
import { isGrowthCheckPassed, resolveGrowthChecks } from "../growth";

describe("isGrowthCheckPassed", () => {
  it("roll 大于技能值即成功", () => {
    expect(isGrowthCheckPassed(41, 40)).toBe(true);
    expect(isGrowthCheckPassed(40, 40)).toBe(false);
    expect(isGrowthCheckPassed(1, 0)).toBe(true);
  });

  it("96-100 必定成功", () => {
    expect(isGrowthCheckPassed(96, 99)).toBe(true);
    expect(isGrowthCheckPassed(100, 100)).toBe(true);
    expect(isGrowthCheckPassed(95, 99)).toBe(false);
  });
});

describe("resolveGrowthChecks", () => {
  it("按顺序为每个技能掷 d100，成功才追加 d10", () => {
    const checks = [
      { id: "a", skillId: "DODGE", beforeValue: 0 },
      { id: "b", skillId: "LISTEN", beforeValue: 0 }
    ];
    const rng = createSeededRng("growth-test");
    const expectedRoll1 = rollDie(rng, 100);
    const expectedGain1 = expectedRoll1 > 0 || expectedRoll1 >= 96 ? rollDie(rng, 10) : 0;
    const expectedRoll2 = rollDie(rng, 100);
    const expectedGain2 = expectedRoll2 > 0 || expectedRoll2 >= 96 ? rollDie(rng, 10) : 0;

    const results = resolveGrowthChecks(checks, createSeededRng("growth-test"));
    expect(results).toEqual([
      { id: "a", skillId: "DODGE", beforeValue: 0, roll: expectedRoll1, passed: true, gain: expectedGain1 },
      { id: "b", skillId: "LISTEN", beforeValue: 0, roll: expectedRoll2, passed: true, gain: expectedGain2 }
    ]);
    expect(results[0]?.gain).toBeGreaterThanOrEqual(1);
    expect(results[0]?.gain).toBeLessThanOrEqual(10);
  });

  it("技能值很高时只有 96-100 才会成长，失败则 gain 为 0", () => {
    for (const seed of ["growth-fail-1", "growth-fail-2", "growth-fail-3", "growth-fail-4", "growth-fail-5"]) {
      const result = resolveGrowthChecks(
        [{ id: "a", skillId: "STRENGTH", beforeValue: 100 }],
        createSeededRng(seed)
      )[0];
      if (result === undefined) throw new Error("缺少成长检定结果");
      expect(result.passed).toBe(result.roll >= 96);
      if (result.passed) {
        expect(result.gain).toBeGreaterThanOrEqual(1);
        expect(result.gain).toBeLessThanOrEqual(10);
      } else {
        expect(result.gain).toBe(0);
      }
    }
  });
});
