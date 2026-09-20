import { describe, expect, it } from "vitest";
import { builtinRegistry, resolveRulePack } from "../index";

const pack = resolveRulePack("touhou-ext", builtinRegistry());

describe("wiki 法术 / 能力速查表", () => {
  it("东方包登记 85 条速查条目", () => {
    expect(pack.spellReferences.length).toBe(85);
  });

  it("覆盖神术 / 魔法 / 属性使 / 妖术四类", () => {
    const categories = new Set(pack.spellReferences.map((entry) => entry.category));
    expect(categories.has("神术·阴阳术")).toBe(true);
    expect(categories.has("魔法")).toBe(true);
    expect(categories.has("属性使")).toBe(true);
    expect(categories.has("妖术")).toBe(true);
  });

  it("结界系 / 其他系 / 九系魔法都有条目", () => {
    const schools = new Set(pack.spellReferences.map((entry) => entry.school));
    for (const school of ["结界系", "其他", "战斗系", "幻觉系", "精神系", "精灵系", "知觉系", "治愈＋生物系", "肉体操作系", "物体操作系", "魔法操作系"]) {
      expect(schools.has(school)).toBe(true);
    }
  });

  it("保留目标值 / 灵力 / 范围 / 时间与说明", () => {
    const 加护 = pack.spellReferences.find((entry) => entry.name === "加护");
    expect(加护?.category).toBe("神术·阴阳术");
    expect(加护?.targetValue).toBe("18");
    expect(加护?.mpCostText).toBe("6");
    expect(加护?.rangeText).toBe("施法者");
    expect((加护?.description ?? "").length).toBeGreaterThan(0);

    const 生成 = pack.spellReferences.find((entry) => entry.name.startsWith("生成"));
    expect(生成?.category).toBe("属性使");
    expect(生成?.school).toBe("基本能力");
  });

  it("标注自动结算状态：内置法术 BUILTIN，纯描述默认 KP", () => {
    const counts = { BUILTIN: 0, PARTIAL: 0, KP: 0 };
    for (const entry of pack.spellReferences) counts[entry.automation] += 1;
    expect(counts.BUILTIN).toBeGreaterThanOrEqual(20);
    expect(counts.PARTIAL).toBe(0);
    expect(counts.KP).toBeGreaterThan(0);
    expect(pack.spellReferences.find((entry) => entry.name === "祈福")?.automation).toBe("BUILTIN");
    expect(pack.spellReferences.find((entry) => entry.name === "属性赋予（属性付与）")?.automation).toBe("BUILTIN");
    expect(pack.spellReferences.find((entry) => entry.name === "禁域结界")?.automation).toBe("KP");
  });

  it("COC7 基线没有东方速查表", () => {
    const coc7 = resolveRulePack("coc7-baseline", builtinRegistry());
    expect(coc7.spellReferences).toEqual([]);
  });
});
