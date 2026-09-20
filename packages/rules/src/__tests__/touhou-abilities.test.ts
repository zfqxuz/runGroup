import { describe, expect, it } from "vitest";
import {
  abilityCostForLevel,
  abilityLevelForPoints,
  abilitySpellCountIssue,
  abilityTotalCost,
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
