import { describe, expect, it } from "vitest";
import { compileParsedRulePack,
  computeDerived,
  deepMerge,
  dpEconomySummary,
  dpRegenFromVars,
  resolveRulePack,
  type RulePack } from "../index";
import { builtinRegistry } from "../packs";

const touhouPack = resolveRulePack("touhou-ext", builtinRegistry());
const costs = touhouPack.dp.actionCosts;

describe("东方扩展只用 DP 模式", () => {
  it("touhou-ext 的 combat.mode 为 DP", () => {
    expect(touhouPack.combat.mode).toBe("DP");
  });
});

describe("DP 行动消耗配置", () => {
  it("千幻抄默认值：弹幕 3、判定 1/骰、追击 2/目标、近战 1+1/骰、抵抗最多 3D", () => {
    expect(costs).toEqual({
      danmaku: 3,
      danmakuDodgeDp: 1,
      danmakuFlatDamage: 3,
      rangedPerDie: 1,
      chasePerTarget: 2,
      meleeApproachPerDie: 1,
      meleeHitPerDie: 1,
      dodgePerDie: 1,
      defendPerDie: 1,
      abilityPerDie: 1,
      resistPerDie: 1,
      coverPerDie: 1,
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

describe("房间尺度参数 ATTR_SCALE", () => {
  const basePack = resolveRulePack("touhou-ext", builtinRegistry());
  const attrs = { str: 50, con: 50, siz: 60, dex: 55, app: 50, int: 60, pow: 40, edu: 70, luck: 45 };

  function compiledWithScale(scale: number) {
    const merged = deepMerge(basePack, { const: { ATTR_SCALE: scale } }) as RulePack;
    return compileParsedRulePack(merged);
  }

  it("ATTR_SCALE=1（默认）保持直接代入", () => {
    const pack = compiledWithScale(1);
    const derived = computeDerived(pack, { attributes: attrs }).derived;
    expect(derived.maxHp).toBe(210);
    expect(derived.maxMp).toBe(160);
    expect(derived.maxDp).toBe(150);
    const vars = { ...attrs, ...derived };
    expect(dpRegenFromVars(pack, vars)).toBe(39);
  });

  it("ATTR_SCALE=10 得到千幻抄原版量级", () => {
    const pack = compiledWithScale(10);
    const derived = computeDerived(pack, { attributes: attrs }).derived;
    expect(derived.maxHp).toBe(30);   // floor(50/10)=5 -> 10+5*4
    expect(derived.maxMp).toBe(16);   // floor(40/10)=4 -> 4*4
    expect(derived.maxDp).toBe(24);   // 10+5+5+4
    const vars = { ...attrs, ...derived };
    expect(dpRegenFromVars(pack, vars)).toBe(4); // ceil((6+5)/3)
  });

  it("ATTR_SCALE=2 得到中间档", () => {
    const pack = compiledWithScale(2);
    const derived = computeDerived(pack, { attributes: attrs }).derived;
    expect(derived.maxHp).toBe(110);  // floor(50/2)=25 -> 10+25*4
    expect(derived.maxMp).toBe(80);   // floor(40/2)=20 -> 80
    expect(derived.maxDp).toBe(80);   // 10+25+25+20
    const vars = { ...attrs, ...derived };
    expect(dpRegenFromVars(pack, vars)).toBe(19); // ceil((30+27)/3)
  });
});
