import { describe, expect, it } from "vitest";
import {
  createSeededRng,
  diceBounds,
  FormulaError,
  normalizeDiceExpression,
  parseDice,
  rollDie,
  rollDice,
  type FormulaErrorCode,
  type Rng
} from "../index";

function expectCode(fn: () => unknown, code: FormulaErrorCode): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FormulaError);
  expect((thrown as FormulaError).code).toBe(code);
}

function take(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(rng.nextUint32());
  return out;
}

describe("骰子表达式归一化", () => {
  it("全角数字 / d / 加减号转换成 ASCII", () => {
    expect(normalizeDiceExpression("１ｄ１００")).toBe("1d100");
    expect(normalizeDiceExpression("２Ｄ６＋３")).toBe("2d6+3");
    expect(normalizeDiceExpression("２ｄ６－１")).toBe("2d6-1");
  });

  it("归一化后可以正常解析", () => {
    expect(parseDice(normalizeDiceExpression("１ｄ１００")).terms).toEqual([
      { kind: "dice", sign: 1, count: 1, sides: 100 }
    ]);
    expect(diceBounds(parseDice(normalizeDiceExpression("２ｄ６＋３")))).toEqual({ min: 5, max: 15 });
  });
});

describe("骰子表达式解析", () => {
  it("2d6+3 拆成两个项", () => {
    const expression = parseDice("2d6+3");
    expect(expression.terms).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6 },
      { kind: "flat", sign: 1, value: 3 }
    ]);
  });

  it("省略个数默认为 1", () => {
    expect(parseDice("d100").terms).toEqual([
      { kind: "dice", sign: 1, count: 1, sides: 100 }
    ]);
  });

  it("支持负项与空白", () => {
    const expression = parseDice(" 2d6 - 1 ");
    expect(expression.terms).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6 },
      { kind: "flat", sign: -1, value: 1 }
    ]);
  });

  it("上下界", () => {
    expect(diceBounds(parseDice("2d6+3"))).toEqual({ min: 5, max: 15 });
    expect(diceBounds(parseDice("1d100"))).toEqual({ min: 1, max: 100 });
    expect(diceBounds(parseDice("2d6-4"))).toEqual({ min: -2, max: 8 });
  });
});

describe("骰子表达式错误", () => {
  it("空表达式", () => {
    expectCode(() => parseDice("  "), "EMPTY_EXPRESSION");
  });

  it("无法识别的项", () => {
    expectCode(() => parseDice("abc"), "INVALID_DICE_EXPRESSION");
    expectCode(() => parseDice("2d6*2"), "INVALID_DICE_EXPRESSION");
  });

  it("悬空符号", () => {
    expectCode(() => parseDice("2d6+"), "INVALID_DICE_EXPRESSION");
  });

  it("个数为 0", () => {
    expectCode(() => parseDice("0d6"), "DICE_LIMIT_EXCEEDED");
  });

  it("面数为 1 没有意义", () => {
    expectCode(() => parseDice("1d1"), "DICE_LIMIT_EXCEEDED");
  });

  it("骰子总数超限", () => {
    expectCode(() => parseDice("100d6+100d6+1d6"), "DICE_LIMIT_EXCEEDED");
  });
});

describe("随机源可复现", () => {
  it("同种子产生同序列", () => {
    expect(take(createSeededRng("battle-001"), 8)).toEqual(take(createSeededRng("battle-001"), 8));
  });

  it("不同种子产生不同序列", () => {
    expect(take(createSeededRng("a"), 8)).not.toEqual(take(createSeededRng("b"), 8));
  });

  it("掷骰结果可复现", () => {
    const expression = parseDice("2d6+3");
    const first = rollDice(expression, createSeededRng("combat-seed"));
    const second = rollDice(expression, createSeededRng("combat-seed"));
    expect(first.total).toBe(second.total);
    expect(first.details).toEqual(second.details);
  });

  it("结果落在上下界内", () => {
    const expression = parseDice("4d6+2");
    const rng = createSeededRng("bounds");
    for (let i = 0; i < 500; i += 1) {
      const result = rollDice(expression, rng);
      expect(result.total).toBeGreaterThanOrEqual(result.min);
      expect(result.total).toBeLessThanOrEqual(result.max);
    }
  });

  it("单骰取值在合法区间", () => {
    const rng = createSeededRng("die");
    for (let i = 0; i < 2000; i += 1) {
      const value = rollDie(rng, 6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it("d6 六个面分布均匀（拒绝采样生效）", () => {
    const rng = createSeededRng("distribution");
    const counts = [0, 0, 0, 0, 0, 0];
    const rolls = 60000;
    for (let i = 0; i < rolls; i += 1) {
      const face = rollDie(rng, 6) - 1;
      counts[face] = (counts[face] as number) + 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(rolls / 6 * 0.95);
      expect(count).toBeLessThan(rolls / 6 * 1.05);
    }
  });
});
