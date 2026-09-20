import { describe, expect, it } from "vitest";
import {
  TOUHOU_STARTING_SPELLCARDS,
  TOUHOU_YOUJUTSU_CREATION_MAX,
  resolveRulePack,
  touhouAbilityGrowthCost,
  touhouAttributeGrowthCost,
  touhouGrowthGrant,
  touhouHpCoefficientAfter,
  touhouHpFromCoefficient,
  touhouRestrictedGrowthCap,
  touhouRestrictedGrowthIssue,
  touhouSkillGrowthCost,
  touhouSkillGrowthIssue,
  touhouSkillGrowthStepCost,
  touhouSpellcardCount,
  touhouSpellcardPoolAfter,
  touhouYoujutsuCountCap,
  touhouYoujutsuCountIssue
} from "../index";
import { builtinRegistry } from "../packs";

const touhouPack = resolveRulePack("touhou-ext", builtinRegistry());
const rules = touhouPack.abilities;

describe("成长等级表（13.1）", () => {
  it("A-F 四类成长量来自 wiki 表", () => {
    expect(rules.growthRanks.A).toEqual({ attribute: 10, skill: 18, ability: 12, hpCoefficient: 0.8, spellcard: 0.7 });
    expect(rules.growthRanks.C).toEqual({ attribute: 6, skill: 12, ability: 8, hpCoefficient: 0.4, spellcard: 0.5 });
    expect(rules.growthRanks.F).toEqual({ attribute: 1, skill: 3, ability: 2, hpCoefficient: 0.1, spellcard: 0.1 });
  });

  it("把 GM 给的 4 个等级分配到四类", () => {
    const grant = touhouGrowthGrant(rules, {
      attribute: "B", skill: "C", ability: "C", hpSpellcard: "D"
    });
    expect(grant).toEqual({ attribute: 8, skill: 12, ability: 8, hpCoefficient: 0.2, spellcard: 0.4 });
  });

  it("未知等级返回 null", () => {
    expect(touhouGrowthGrant(rules, { attribute: "Z" })).toBeNull();
  });
});

describe("特性值 / 技能成长（13.2.1 / 13.2.2）", () => {
  it("特性值 n→n+1 花费 n+1", () => {
    expect(touhouAttributeGrowthCost(0, 1)).toBe(1);
    expect(touhouAttributeGrowthCost(0, 4)).toBe(10);
    expect(touhouAttributeGrowthCost(3, 4)).toBe(4);
  });

  it("技能升到第 L 级花 L 点，5 级及以后固定 5 点", () => {
    expect(touhouSkillGrowthStepCost(1)).toBe(1);
    expect(touhouSkillGrowthStepCost(5)).toBe(5);
    expect(touhouSkillGrowthStepCost(6)).toBe(5);
    expect(touhouSkillGrowthCost(0, 5)).toBe(15);
    expect(touhouSkillGrowthCost(0, 7)).toBe(25);
  });

  it("一次成长最多 1 级", () => {
    expect(touhouSkillGrowthIssue(2, 3)).toBeNull();
    expect(touhouSkillGrowthIssue(2, 4)).toContain("最多提升 1 级");
  });
});

describe("能力成长与 60% 限制（13.2.3）", () => {
  it("神术 0→3 花费 5+10+15=30", () => {
    const spirit = rules.categories.SPIRIT_ARTS;
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(touhouAbilityGrowthCost(spirit, 0, 3)).toBe(30);
    expect(touhouAbilityGrowthCost(spirit, 2, 4)).toBe(35);
  });

  it("妖术 / 锻炼上限为成长能力点的 60%（向上取整）", () => {
    expect(touhouRestrictedGrowthCap(60)).toBe(36);
    expect(touhouRestrictedGrowthIssue(60, 36)).toBeNull();
    expect(touhouRestrictedGrowthIssue(60, 37)).toContain("60%");
  });
});

describe("HP 系数与 SC 成长（13.2.4 / 13.6）", () => {
  it("SC 持有数从小数池向下取整", () => {
    let pool = TOUHOU_STARTING_SPELLCARDS;
    expect(touhouSpellcardCount(pool)).toBe(3);
    pool = touhouSpellcardPoolAfter(pool, rules.growthRanks.A?.spellcard ?? 0);
    expect(pool).toBeCloseTo(3.7, 5);
    expect(touhouSpellcardCount(pool)).toBe(3);
    pool = touhouSpellcardPoolAfter(pool, rules.growthRanks.B?.spellcard ?? 0);
    expect(touhouSpellcardCount(pool)).toBe(4);
  });

  it("HP 系数从小数累计，HP = 10 + 耐久×系数 向上取整", () => {
    const coefficient = touhouHpCoefficientAfter(4, rules.growthRanks.A?.hpCoefficient ?? 0);
    expect(coefficient).toBeCloseTo(4.8, 5);
    expect(touhouHpFromCoefficient(3, coefficient)).toBe(25);
  });
});

describe("妖术数量上限（10.2）", () => {
  it("总数上限 = 最高级妖术 Lv + 2", () => {
    expect(TOUHOU_YOUJUTSU_CREATION_MAX).toBe(4);
    expect(touhouYoujutsuCountCap(3)).toBe(5);
    expect(touhouYoujutsuCountIssue(3, 5)).toBeNull();
    expect(touhouYoujutsuCountIssue(3, 6)).toContain("上限 5");
  });
});
