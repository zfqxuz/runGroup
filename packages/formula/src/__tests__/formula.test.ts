import { describe, expect, it } from "vitest";
import {
  compile,
  evaluate,
  FormulaError,
  type EvalContext,
  type FormulaErrorCode
} from "../index";

const context: EvalContext = {
  vars: { con: 50, siz: 60, dex: 55, pow: 40, str: 30 },
  consts: { MP_PER_POW: 4, DP_BASE: 10 }
};

const varNames = Object.keys(context.vars ?? {});
const constNames = Object.keys(context.consts ?? {});

function ev(source: string, ctx: EvalContext = context): number {
  return evaluate(compile(source, { vars: varNames, consts: constNames }), ctx);
}

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

describe("RulePack 实际会用到的公式", () => {
  it("COC7 衍生属性 maxHp", () => {
    expect(ev("floor((con + siz) / 10)")).toBe(11);
  });

  it("东方扩展 maxMp 用常量", () => {
    expect(ev("pow * MP_PER_POW")).toBe(160);
  });

  it("DP 公式混合变量与常量", () => {
    expect(ev("DP_BASE + str + con + pow")).toBe(130);
  });

  it("ATB 速度公式", () => {
    expect(ev("2 + dex / 10")).toBe(7.5);
  });
});

describe("求值语义", () => {
  it("乘法优先于加法", () => {
    expect(ev("2 + 3 * 4")).toBe(14);
  });

  it("括号改变优先级", () => {
    expect(ev("(2 + 3) * 4")).toBe(20);
  });

  it("幂右结合", () => {
    expect(ev("2^3^2")).toBe(512);
  });

  it("一元负号弱于幂", () => {
    expect(ev("-2^2")).toBe(-4);
  });

  it("幂的指数可以是负数", () => {
    expect(ev("2^-3")).toBe(0.125);
  });

  it("取模", () => {
    expect(ev("10 % 3")).toBe(1);
  });

  it("clamp 上下界", () => {
    expect(ev("clamp(15, 0, 10)")).toBe(10);
    expect(ev("clamp(-5, 0, 10)")).toBe(0);
  });

  it("min / max 可变参数", () => {
    expect(ev("min(3, 1, 2)")).toBe(1);
    expect(ev("max(3, 1, 2)")).toBe(3);
  });

  it("比较返回 1 / 0", () => {
    expect(ev("con >= 50")).toBe(1);
    expect(ev("con > 50")).toBe(0);
    expect(ev("con == 50")).toBe(1);
    expect(ev("con != 50")).toBe(0);
  });

  it("if 是惰性求值，未选中的分支不参与计算", () => {
    expect(ev("if(1 == 1, 7, 1 / 0)")).toBe(7);
    expect(ev("if(1 == 0, 1 / 0, 9)")).toBe(9);
  });

  it("逻辑运算符短路", () => {
    expect(ev("1 == 0 && 1 / 0")).toBe(0);
    expect(ev("1 == 1 || 1 / 0")).toBe(1);
  });

  it("三元表达式", () => {
    expect(ev("con > 100 ? 1 : 2")).toBe(2);
    expect(ev("con > 10 ? 1 : 2")).toBe(1);
  });
});

describe("编译期校验：配置错误必须 fail-fast", () => {
  it("未声明标识符报错并给出位置", () => {
    let thrown: unknown;
    try {
      compile("con + luckX", { vars: ["con"], consts: [] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FormulaError);
    const err = thrown as FormulaError;
    expect(err.code).toBe("UNKNOWN_IDENTIFIER");
    expect(err.position).toBe(6);
    expect(err.message).toContain("luckX");
  });

  it("未知函数", () => {
    expectCode(() => compile("wat(1)", { vars: [], consts: [] }), "UNKNOWN_FUNCTION");
  });

  it("参数个数不匹配", () => {
    expectCode(() => compile("clamp(1, 2)", { vars: [], consts: [] }), "ARITY_MISMATCH");
    expectCode(() => compile("floor(1, 2)", { vars: [], consts: [] }), "ARITY_MISMATCH");
  });

  it("同名变量与常量", () => {
    expectCode(() => compile("a", { vars: ["a"], consts: ["a"] }), "DUPLICATE_BINDING");
  });

  it("保留标识符", () => {
    expectCode(
      () => compile("__proto", { vars: ["__proto"], consts: [] }),
      "RESERVED_IDENTIFIER"
    );
  });

  it("空表达式", () => {
    expectCode(() => compile("   ", { vars: [], consts: [] }), "EMPTY_EXPRESSION");
  });

  it("多余输入", () => {
    expectCode(() => compile("1 + 2 3", { vars: [], consts: [] }), "UNEXPECTED_TOKEN");
  });

  it("赋值被拒绝", () => {
    expectCode(() => compile("a = 1", { vars: ["a"], consts: [] }), "UNEXPECTED_TOKEN");
  });

  it("单感叹号提示用 != 或 ==", () => {
    expectCode(() => compile("a ! 1", { vars: ["a"], consts: [] }), "UNEXPECTED_TOKEN");
  });

  it("嵌套过深", () => {
    const deep = "(".repeat(40) + "1" + ")".repeat(40);
    expectCode(() => compile(deep, { vars: [], consts: [] }), "EXPRESSION_TOO_DEEP");
  });
});

describe("运行时错误", () => {
  it("除零", () => {
    const expression = compile("pow / 0", { vars: ["pow"], consts: [] });
    expectCode(() => evaluate(expression, { vars: { pow: 10 } }), "DIVISION_BY_ZERO");
  });

  it("数学定义域", () => {
    const expression = compile("sqrt(-1)", { vars: [], consts: [] });
    expectCode(() => evaluate(expression), "MATH_DOMAIN");
  });

  it("求值时缺变量", () => {
    const expression = compile("pow", { vars: ["pow"], consts: [] });
    expectCode(() => evaluate(expression), "UNKNOWN_IDENTIFIER");
  });

  it("0 是合法取值，不能被当成缺失", () => {
    const expression = compile("pow + 1", { vars: ["pow"], consts: [] });
    expect(evaluate(expression, { vars: { pow: 0 } })).toBe(1);
  });
});

describe("依赖收集：供 RulePack 校验与 UI 提示使用", () => {
  it("区分变量与常量", () => {
    const expression = compile("con + MP_PER_POW", { vars: ["con"], consts: ["MP_PER_POW"] });
    expect(expression.vars).toEqual(["con"]);
    expect(expression.consts).toEqual(["MP_PER_POW"]);
  });

  it("记录函数依赖，含幂运算转出的 pow", () => {
    const expression = compile("floor(2^2)", { vars: [], consts: [] });
    expect([...expression.functions].sort()).toEqual(["floor", "pow"]);
  });
});
