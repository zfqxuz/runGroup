import { describe, expect, it } from "vitest";
import {
  abilityCostForLevel,
  abilityLevelForPoints,
  abilityPointBudget,
  abilitySpellCountIssue,
  abilitySpendTotal,
  abilityTotalCost,
  resolveAbilityCategory,
  splitAbilityInstanceId,
  validateAbilitySpend,
  compileParsedRulePack,
  resolveRulePack
} from "../index";
import { builtinRegistry } from "../packs";

const registry = builtinRegistry();
const touhouPack = resolveRulePack("touhou-ext", registry);
const coc7Pack = resolveRulePack("coc7-baseline", registry);
const touhou = compileParsedRulePack(touhouPack);

describe("千幻抄能力类别与消费表", () => {
  it("TOUHOU 包启用能力体系并登记五类能力", () => {
    expect(touhouPack.abilities.enabled).toBe(true);
    expect(Object.keys(touhouPack.abilities.categories).sort()).toEqual(
      ["ELEMENTALIST", "FEAT", "MAGIC", "SPIRIT_ARTS", "YOUJUTSU"].sort()
    );
  });

  it("神术 / 魔法 / 属性使 / 妖术 / 特技使用各自消费表", () => {
    expect(touhouPack.abilities.categories.SPIRIT_ARTS?.costTable).toEqual([5, 10, 15, 20, 25, 25]);
    expect(touhouPack.abilities.categories.MAGIC?.costTable).toEqual([5, 10, 15, 20, 25, 25]);
    expect(touhouPack.abilities.categories.ELEMENTALIST?.costTable).toEqual([4, 8, 12, 16, 20, 20]);
    expect(touhouPack.abilities.categories.YOUJUTSU?.costTable).toEqual([1, 2, 4, 6, 8, 10, 12, 12]);
    expect(touhouPack.abilities.categories.FEAT?.costTable).toEqual([1, 2, 4, 6, 8, 10, 12, 12]);
  });

  it("COC7 基线不启用能力体系", () => {
    expect(coc7Pack.abilities.enabled).toBe(false);
    expect(Object.keys(coc7Pack.abilities.categories)).toHaveLength(0);
  });

  it("车卡能力点为 A/B/C/D = 30/25/20/15", () => {
    expect(abilityPointBudget(touhouPack.abilities, "A")).toBe(30);
    expect(abilityPointBudget(touhouPack.abilities, "B")).toBe(25);
    expect(abilityPointBudget(touhouPack.abilities, "C")).toBe(20);
    expect(abilityPointBudget(touhouPack.abilities, "D")).toBe(15);
    expect(abilityPointBudget(touhouPack.abilities, "X")).toBeNull();
  });

  it("能力点花费校验：超支 / 未知类别 / 通过", () => {
    // 神术 5+10=15，妖术 1+2=3，合计 18
    const levels = { SPIRIT_ARTS: 2, YOUJUTSU: 2 };
    expect(abilitySpendTotal(touhouPack.abilities, levels)).toBe(18);
    // A 级预算 30，18 点通过；D 级预算 15，18 点超支。
    expect(validateAbilitySpend(touhouPack.abilities, "A", levels).ok).toBe(true);
    expect(validateAbilitySpend(touhouPack.abilities, "D", levels).ok).toBe(false);
    // 神术 5+10+15 = 30，D 级 15 点超支。
    expect(validateAbilitySpend(touhouPack.abilities, "D", { SPIRIT_ARTS: 3 }).ok).toBe(false);
    const unknown = validateAbilitySpend(touhouPack.abilities, "A", { NOT_A_CATEGORY: 1 });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("未知能力类别");
  });

  it("补齐了〈抵抗〉技能，供抵抗判定使用", () => {
    expect(touhouPack.skills.some((skill) => skill.id === "RESIST")).toBe(true);
    expect(touhou.skills.some((skill) => skill.id === "RESIST")).toBe(true);
  });
});

describe("能力消费表计算", () => {
  const spirit = touhouPack.abilities.categories.SPIRIT_ARTS;

  it("逐级消费：第 n 级取 costTable[n-1]，超出表长固定最后一档", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(abilityCostForLevel(spirit, 1)).toBe(5);
    expect(abilityCostForLevel(spirit, 2)).toBe(10);
    expect(abilityCostForLevel(spirit, 5)).toBe(25);
    expect(abilityCostForLevel(spirit, 6)).toBe(25);
    expect(abilityCostForLevel(spirit, 9)).toBe(25);
    expect(abilityCostForLevel(spirit, 0)).toBe(0);
  });

  it("累计消费与按点数反推等级", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(abilityTotalCost(spirit, 3)).toBe(30);
    expect(abilityLevelForPoints(spirit, 30)).toBe(3);
    expect(abilityLevelForPoints(spirit, 29)).toBe(2);
    expect(abilityLevelForPoints(spirit, 0)).toBe(0);
  });

  it("按每级习得上限校验法术数量", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    // 神术每级 2 个：Lv2 最多 4 个
    expect(abilitySpellCountIssue(spirit, 2, 4)).toBeNull();
    expect(abilitySpellCountIssue(spirit, 2, 5)).toContain("最多习得 4 个法术");
    const elementalist = touhouPack.abilities.categories.ELEMENTALIST;
    if (elementalist === undefined) throw new Error("缺少 ELEMENTALIST");
    // 0 表示不限
    expect(abilitySpellCountIssue(elementalist, 3, 999)).toBeNull();
  });
});

describe("能力实例 id（属性使每种属性独立）", () => {
  it("splitAbilityInstanceId 拆分 CATEGORY:SUFFIX", () => {
    expect(splitAbilityInstanceId("ELEMENTALIST:FIRE")).toEqual({ categoryId: "ELEMENTALIST", suffix: "FIRE" });
    expect(splitAbilityInstanceId("SPIRIT_ARTS")).toEqual({ categoryId: "SPIRIT_ARTS", suffix: null });
  });

  it("resolveAbilityCategory 精确匹配优先，再退回前缀类别", () => {
    const rules = touhouPack.abilities;
    expect(resolveAbilityCategory(rules, "SPIRIT_ARTS")?.id).toBe("SPIRIT_ARTS");
    expect(resolveAbilityCategory(rules, "ELEMENTALIST:FIRE")?.id).toBe("ELEMENTALIST");
    expect(resolveAbilityCategory(rules, "NOPE:FIRE")).toBeUndefined();
  });

  it("能力点按实例累计消费", () => {
    const rules = touhouPack.abilities;
    // 属性使 4/8/12：FIRE Lv2 = 12，WATER Lv1 = 4，合计 16
    expect(abilitySpendTotal(rules, { "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 1 })).toBe(16);
    expect(validateAbilitySpend(rules, "C", { "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 1 }).ok).toBe(true);
  });
});
