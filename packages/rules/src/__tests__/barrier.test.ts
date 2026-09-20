import { describe, expect, it } from "vitest";
import {
  barrierDispelSuccess,
  barrierLevelEntry,
  barrierRestackOutcome,
  resizeBarrierHp,
  resolveBarrierStats,
  type BarrierRules
} from "../index";

const rules: BarrierRules = {
  enabled: true,
  restack: "REPLACE",
  dispelNeedsContest: true,
  sizes: {
    SMALL: {
      id: "SMALL",
      name: "小",
      scopeMeters: "1",
      capacity: 1,
      hpMultiplier: "1",
      mpMultiplier: "1",
      penalty: "0"
    },
    LARGE: {
      id: "LARGE",
      name: "大",
      scopeMeters: "6",
      capacity: 0,
      hpMultiplier: "2",
      mpMultiplier: "1.5",
      penalty: "2"
    }
  },
  levels: [
    { level: 1, hp: "10 + pow", targetValue: "12", mpCost: "4", durationTicks: "3" },
    { level: 3, hp: "20 + pow * 2", targetValue: "16", mpCost: "8", durationTicks: "5" }
  ]
};

describe("7.5 结界查表", () => {
  it("barrierLevelEntry 取 <= 请求等级的最高档", () => {
    expect(barrierLevelEntry(rules, 1)?.level).toBe(1);
    expect(barrierLevelEntry(rules, 2)?.level).toBe(1);
    expect(barrierLevelEntry(rules, 3)?.level).toBe(3);
    expect(barrierLevelEntry(rules, 9)?.level).toBe(3);
  });

  it("resolveBarrierStats 求 HP / 目标值 / 灵力消耗 / 持续 / 惩罚", () => {
    const stats = resolveBarrierStats(rules, { level: 3, sizeId: "LARGE", vars: { pow: 5 } });
    expect(stats).not.toBeNull();
    // 基础 HP 20 + 5*2 = 30，大结界 ×2 = 60
    expect(stats?.hp).toBe(60);
    expect(stats?.maxHp).toBe(60);
    expect(stats?.targetValue).toBe(16);
    // 灵力 8 × 1.5 = 12
    expect(stats?.mpCost).toBe(12);
    expect(stats?.durationTicks).toBe(5);
    expect(stats?.penalty).toBe(2);
    expect(stats?.scopeMeters).toBe(6);
    expect(stats?.sizeName).toBe("大");
  });

  it("未启用返回 null；无等级档时使用 fallbackHp 并保留 size 惩罚", () => {
    expect(resolveBarrierStats({ ...rules, enabled: false }, { level: 1 })).toBeNull();
    const stats = resolveBarrierStats({ ...rules, levels: [] }, {
      level: 1,
      sizeId: "LARGE",
      fallbackHp: 25
    });
    expect(stats?.hp).toBe(50); // 25 × 2
    expect(stats?.penalty).toBe(2);
    expect(stats?.targetValue).toBe(0);
  });

  it("扩大 / 缩小按比例迁移 HP", () => {
    const shrink = resizeBarrierHp({ hp: 30, maxHp: 40, direction: "SHRINK" }, 20);
    expect(shrink.levelDelta).toBe(-1);
    expect(shrink.maxHp).toBe(20);
    expect(shrink.hp).toBe(15);
    expect(shrink.collapsed).toBe(false);
    const collapsed = resizeBarrierHp({ hp: 30, maxHp: 40, direction: "SHRINK", amount: 10 }, 0);
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.hp).toBe(0);
  });

  it("解除对抗与重复展开规则", () => {
    expect(barrierDispelSuccess({ achievement: 15, targetValue: 16, needsContest: true })).toBe(false);
    expect(barrierDispelSuccess({ achievement: 16, targetValue: 16, needsContest: true })).toBe(true);
    expect(barrierDispelSuccess({ achievement: 0, targetValue: 16, needsContest: false })).toBe(true);

    expect(barrierRestackOutcome("REPLACE", 5, 10, 8)).toEqual({ hp: 8, maxHp: 8, replaced: true });
    expect(barrierRestackOutcome("REFRESH", 5, 10, 8)).toEqual({ hp: 8, maxHp: 10, replaced: false });
    expect(barrierRestackOutcome("STACK", 5, 10, 8)).toEqual({ hp: 13, maxHp: 18, replaced: false });
  });
});
