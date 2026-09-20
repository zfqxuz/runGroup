import { describe, expect, it } from "vitest";
import {
  barrierConfinementPenalty,
  barrierDispelSuccess,
  barrierDodgeTargetValue,
  barrierRestackOutcome,
  barrierResizeCost,
  barrierTierForSize,
  resizeBarrierHp,
  resolveBarrierStats,
  type BarrierRules
} from "../index";

const rules: BarrierRules = {
  enabled: true,
  restack: "REPLACE",
  dispelNeedsContest: true,
  castRangeMeters: 30,
  resizeMpCost: 2,
  durationHoursPerLevel: 2,
  dodgeSizeDivisor: 2,
  confinementPenalties: [
    { maxMeters: 1, penalty: 8 },
    { maxMeters: 2, penalty: 3 }
  ],
  extended: {
    sizeStepMeters: 10,
    requiredLevelPerStep: 1,
    targetValuePerStep: 2,
    mpCostPerStep: 2
  },
  tiers: [
    { id: "SIZE_2", name: "2m", sizeMeters: 2, requiredLevel: 1, targetValue: 16, mpCost: 4 },
    { id: "SIZE_5", name: "5m", sizeMeters: 5, requiredLevel: 2, targetValue: 18, mpCost: 6 },
    { id: "SIZE_10", name: "10m", sizeMeters: 10, requiredLevel: 3, targetValue: 20, mpCost: 8 },
    { id: "SIZE_40", name: "40m", sizeMeters: 40, requiredLevel: 8, targetValue: 30, mpCost: 18 }
  ]
};

describe("7.5 结界查表（wiki 表 7.1）", () => {
  it("barrierTierForSize 取 <= 大小的最高档，超出最大档按 extended 扩展", () => {
    expect(barrierTierForSize(rules, 2).tier?.id).toBe("SIZE_2");
    expect(barrierTierForSize(rules, 4).tier?.id).toBe("SIZE_2");
    expect(barrierTierForSize(rules, 5).tier?.id).toBe("SIZE_5");
    expect(barrierTierForSize(rules, 40).tier?.id).toBe("SIZE_40");
    const beyond = barrierTierForSize(rules, 55);
    expect(beyond.tier?.id).toBe("SIZE_40");
    expect(beyond.extraSteps).toBe(2); // (55-40)/10 向上取整
  });

  it("resolveBarrierStats 求目标值 / 灵力 / 必要 Lv / 持续 / 惩罚", () => {
    const stats = resolveBarrierStats(rules, { sizeMeters: 10, casterLevel: 3, fallbackHp: 30 });
    expect(stats?.tierId).toBe("SIZE_10");
    expect(stats?.targetValue).toBe(20);
    expect(stats?.mpCost).toBe(8);
    expect(stats?.requiredLevel).toBe(3);
    expect(stats?.durationHours).toBe(6); // Lv3 × 2
    expect(stats?.hp).toBe(30);
    expect(stats?.penalty).toBe(0); // 10m 不触发狭小惩罚
  });

  it("超出最大档位线性扩展：+10m / +1Lv / 目标 +2 / 灵力 +2", () => {
    const stats = resolveBarrierStats(rules, { sizeMeters: 55, casterLevel: 8, fallbackHp: 10 });
    expect(stats?.requiredLevel).toBe(10);
    expect(stats?.targetValue).toBe(34);
    expect(stats?.mpCost).toBe(22);
  });

  it("结界内战斗惩罚：2m² -3、1m² -8", () => {
    expect(barrierConfinementPenalty(rules, 1)).toBe(8);
    expect(barrierConfinementPenalty(rules, 2)).toBe(3);
    expect(barrierConfinementPenalty(rules, 5)).toBe(0);
  });

  it("回避目标值 = 达成值 + floor(大小/2)，扩大缩小每级 2 灵力", () => {
    expect(barrierDodgeTargetValue(20, 10, rules)).toBe(25);
    expect(barrierDodgeTargetValue(20, 3, rules)).toBe(21);
    expect(barrierResizeCost(rules, 3)).toBe(6);
  });

  it("扩大 / 缩小按比例迁移 HP", () => {
    const shrink = resizeBarrierHp({ hp: 30, maxHp: 40, direction: "SHRINK" }, 20);
    expect(shrink.levelDelta).toBe(-1);
    expect(shrink.maxHp).toBe(20);
    expect(shrink.hp).toBe(15);
    const collapsed = resizeBarrierHp({ hp: 30, maxHp: 40, direction: "SHRINK", amount: 10 }, 0);
    expect(collapsed.collapsed).toBe(true);
  });

  it("解除对抗与重复展开规则", () => {
    expect(barrierDispelSuccess({ achievement: 15, targetValue: 16, needsContest: true })).toBe(false);
    expect(barrierDispelSuccess({ achievement: 16, targetValue: 16, needsContest: true })).toBe(true);
    expect(barrierDispelSuccess({ achievement: 0, targetValue: 16, needsContest: false })).toBe(true);
    expect(barrierRestackOutcome("REPLACE", 5, 10, 8)).toEqual({ hp: 8, maxHp: 8, replaced: true });
    expect(barrierRestackOutcome("STACK", 5, 10, 8)).toEqual({ hp: 13, maxHp: 18, replaced: false });
  });
});
