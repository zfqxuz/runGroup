import { describe, expect, it } from "vitest";
import { dpEconomySummary, resolveRulePack } from "../index";
import { builtinRegistry } from "../packs";

const costs = resolveRulePack("touhou-ext", builtinRegistry()).dp.actionCosts;

describe("DP 行动消耗配置", () => {
  it("千幻抄默认值：弹幕 3、判定 1/骰、追击 2/目标、近战 1+1/骰、抵抗最多 3D", () => {
    expect(costs).toEqual({
      danmaku: 3,
      rangedPerDie: 1,
      chasePerTarget: 2,
      meleeApproachPerDie: 1,
      meleeHitPerDie: 1,
      dodgePerDie: 1,
      defendPerDie: 1,
      resistMaxDice: 3
    });
  });
});

describe("DP / MP 资源经济换算", () => {
  it("直接代入 A 口径（DP150 / 回复39 / MP160）", () => {
    const summary = dpEconomySummary({ dpMax: 150, dpRegen: 39, mp: 160, actionCosts: costs });
    expect(summary.danmakuPerRound).toBe(13);
    expect(summary.danmakuPerBattle).toBe(50);
    expect(summary.rangedChecksPerRound).toBe(13);
    expect(summary.meleeChecksPerRound).toBe(6); // (1+1)*3 = 6 DP
    expect(summary.chaseTargetsPerRound).toBe(19);
    expect(summary.abilityCastsPerMp).toBe(10);
  });

  it("÷10 映射 B 口径（DP24 / 回复4 / MP16）", () => {
    const summary = dpEconomySummary({ dpMax: 24, dpRegen: 4, mp: 16, actionCosts: costs });
    expect(summary.danmakuPerRound).toBe(1);
    expect(summary.danmakuPerBattle).toBe(8);
    expect(summary.rangedChecksPerRound).toBe(1);
    expect(summary.chaseTargetsPerRound).toBe(2);
    expect(summary.abilityCastsPerMp).toBe(1);
  });

  it("骰数可选：1D 近战消耗 (1+1)×1 = 2 DP", () => {
    const summary = dpEconomySummary({
      dpMax: 24,
      dpRegen: 4,
      mp: 16,
      actionCosts: costs,
      dicePerCheck: 1
    });
    expect(summary.meleeChecksPerRound).toBe(2);
    expect(summary.referenceCosts.melee).toBe(2);
  });

  it("消耗为 0 时不产生行动次数，也不会除零", () => {
    const summary = dpEconomySummary({
      dpMax: 10,
      dpRegen: 5,
      mp: 30,
      actionCosts: { ...costs, danmaku: 0 }
    });
    expect(summary.danmakuPerRound).toBe(0);
    expect(summary.danmakuPerBattle).toBe(0);
  });
});
