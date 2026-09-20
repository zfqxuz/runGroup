import { describe, expect, it } from "vitest";
import { applyDamagePipeline, compileParsedRulePack, resolveRulePack } from "../index";
import { builtinRegistry } from "../packs";

const registry = builtinRegistry();
const touhouPack = resolveRulePack("touhou-ext", registry);
const touhou = compileParsedRulePack(touhouPack);
const coc7Pack = resolveRulePack("coc7-baseline", registry);
const coc7 = compileParsedRulePack(coc7Pack);

describe("东方属性表", () => {
  it("包含木火土金水风雷冷气光暗十种属性", () => {
    expect(Object.keys(touhouPack.elements).sort()).toEqual(
      ["DARK", "EARTH", "FIRE", "ICE", "LIGHT", "METAL", "THUNDER", "WATER", "WIND", "WOOD"].sort()
    );
  });

  it("五行相克关系正确，且 weakTo 与 strongAgainst 反向一致", () => {
    expect(touhouPack.elements.WATER?.strongAgainst).toContain("FIRE");
    expect(touhouPack.elements.FIRE?.strongAgainst).toContain("METAL");
    expect(touhouPack.elements.METAL?.strongAgainst).toContain("WOOD");
    expect(touhouPack.elements.WOOD?.strongAgainst).toContain("EARTH");
    expect(touhouPack.elements.EARTH?.strongAgainst).toContain("WATER");
    // 光暗互克
    expect(touhouPack.elements.LIGHT?.strongAgainst).toContain("DARK");
    expect(touhouPack.elements.DARK?.strongAgainst).toContain("LIGHT");

    // 反向 weakTo 必须与别人的 strongAgainst 对齐
    for (const [id, element] of Object.entries(touhouPack.elements)) {
      for (const target of element.strongAgainst) {
        expect(touhouPack.elements[target]?.weakTo, `${id} -> ${target}`).toContain(id);
      }
    }
  });

  it("种族先天元素已登记", () => {
    expect(touhouPack.races.KAPPA?.elements).toContain("WATER");
    expect(touhouPack.races.TENGU?.elements).toContain("WIND");
    expect(touhouPack.races.VAMPIRE?.elements).toContain("DARK");
    expect(touhouPack.races.DEMON?.elements).toContain("DARK");
  });
});

describe("ELEMENT_MOD 伤害管线隔离", () => {
  it("TOUHOU 管线应用元素固定加减值", () => {
    const boosted = applyDamagePipeline(touhou, {
      baseDamage: 10,
      defense: "PASS",
      elementFlat: 6
    });
    expect(boosted.damage).toBe(16);
    expect(boosted.steps.some((step) => step.includes("element +6"))).toBe(true);

    const reduced = applyDamagePipeline(touhou, {
      baseDamage: 10,
      defense: "PASS",
      elementFlat: -4
    });
    expect(reduced.damage).toBe(6);
    expect(reduced.steps.some((step) => step.includes("element -4"))).toBe(true);
  });

  it("COC7 基线管线不含 ELEMENT_MOD，传入属性值也不改变伤害", () => {
    const outcome = applyDamagePipeline(coc7, {
      baseDamage: 10,
      defense: "PASS",
      elementFlat: 6
    });
    expect(outcome.damage).toBe(10);
    expect(outcome.steps.some((step) => step.includes("element"))).toBe(false);
  });

  it("COC7 基线没有元素表", () => {
    expect(Object.keys(coc7Pack.elements)).toHaveLength(0);
  });
});
