import { describe, expect, it } from "vitest";
import { createSeededRng } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  attributeTotal,
  builtinRegistry,
  checkPointBuy,
  resolveRulePack,
  rollAttributeSets,
  type AttributeSet
} from "../index";

const destinyMethod = {
  kind: "ROLL_SETS" as const,
  id: "destiny5",
  label: "天命 5",
  sets: 5,
  dice: "3d6",
  multiplier: 5
};

const pointMethod = {
  kind: "POINT_BUY" as const,
  id: "point480",
  label: "总点数 480",
  total: 480,
  perAttributeMin: 15,
  perAttributeMax: 90
};

function makeAttributes(values: readonly number[]): AttributeSet {
  const result: Record<string, number> = {};
  ATTRIBUTE_KEYS.forEach((key, index) => {
    result[key] = values[index] ?? 0;
  });
  return result as unknown as AttributeSet;
}

describe("规则包内置的车卡方式", () => {
  it("COC7 基线同时提供天命 5 与总点数 480", () => {
    const pack = resolveRulePack("coc7-baseline", builtinRegistry());
    const ids = pack.attributes.methods.map((method) => method.id);
    expect(ids).toContain("destiny5");
    expect(ids).toContain("point480");
  });

  it("东方包继承同一套车卡方式", () => {
    const pack = resolveRulePack("touhou-ext", builtinRegistry());
    const ids = pack.attributes.methods.map((method) => method.id);
    expect(ids).toContain("destiny5");
    expect(ids).toContain("point480");
  });
});

describe("天命 5", () => {
  it("掷出 5 组，每组 9 项", () => {
    const options = rollAttributeSets(destinyMethod, createSeededRng("destiny"));
    expect(options.length).toBe(5);
    for (const option of options) {
      expect(Object.keys(option.attributes).length).toBe(9);
    }
  });

  it("每项落在 3d6×5 的合法区间 15~90", () => {
    const options = rollAttributeSets(destinyMethod, createSeededRng("range"));
    for (const option of options) {
      for (const key of ATTRIBUTE_KEYS) {
        expect(option.attributes[key]).toBeGreaterThanOrEqual(15);
        expect(option.attributes[key]).toBeLessThanOrEqual(90);
      }
    }
  });

  it("同种子可复现", () => {
    const a = rollAttributeSets(destinyMethod, createSeededRng("same"));
    const b = rollAttributeSets(destinyMethod, createSeededRng("same"));
    expect(a).toEqual(b);
  });

  it("不同种子给出不同结果", () => {
    const a = rollAttributeSets(destinyMethod, createSeededRng("seed-a"));
    const b = rollAttributeSets(destinyMethod, createSeededRng("seed-b"));
    expect(a).not.toEqual(b);
  });
});

describe("总点数 480", () => {
  it("刚好用完且都在区间内则通过", () => {
    const attributes = makeAttributes([53, 53, 53, 53, 53, 53, 53, 53, 56]);
    const result = checkPointBuy(pointMethod, attributes);
    expect(result.total).toBe(480);
    expect(result.remaining).toBe(0);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("少 1 点会被拦下", () => {
    const attributes = makeAttributes([53, 53, 53, 53, 53, 53, 53, 53, 55]);
    const result = checkPointBuy(pointMethod, attributes);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(1);
    expect(result.errors.join(" ")).toContain("还剩 1 点");
  });

  it("超出总点数会被拦下", () => {
    const attributes = makeAttributes([60, 60, 60, 60, 60, 60, 60, 60, 60]);
    const result = checkPointBuy(pointMethod, attributes);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(-60);
    expect(result.errors.join(" ")).toContain("超出 60 点");
  });

  it("单项低于下限会被拦下", () => {
    const attributes = makeAttributes([10, 60, 60, 60, 55, 55, 55, 55, 70]);
    expect(checkPointBuy(pointMethod, attributes).errors.join(" ")).toContain("低于下限 15");
  });

  it("单项高于上限会被拦下", () => {
    const attributes = makeAttributes([91, 53, 53, 53, 53, 53, 53, 53, 48]);
    expect(checkPointBuy(pointMethod, attributes).errors.join(" ")).toContain("高于上限 90");
  });

  it("attributeTotal 等于 9 项之和", () => {
    const attributes = makeAttributes([15, 30, 45, 60, 75, 90, 15, 30, 120]);
    expect(attributeTotal(attributes)).toBe(480);
  });
});
