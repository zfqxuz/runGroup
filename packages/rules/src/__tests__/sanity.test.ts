import { describe, expect, it } from "vitest";
import type { Rng } from "@touhou/formula";
import { resolveSanityCheck, rollSanityLoss } from "../sanity";

function queueRng(values: number[]): Rng {
  return { nextUint32: () => values.shift() ?? 0 };
}

describe("SAN 检定", () => {
  it("固定损失表达式", () => {
    expect(rollSanityLoss("3", queueRng([]))).toBe(3);
    expect(rollSanityLoss("0", queueRng([]))).toBe(0);
  });

  it("成功时使用成功损失", () => {
    // rollDie(100) 面值 40；成功损失 0，不再消耗随机数
    const result = resolveSanityCheck(50, "0", "1d6", queueRng([39]));
    expect(result.success).toBe(true);
    expect(result.roll).toBe(40);
    expect(result.loss).toBe(0);
    expect(result.sanAfter).toBe(50);
    expect(result.massive).toBe(false);
  });

  it("失败时使用失败损失并识别单次损失 5+", () => {
    // rollDie(100)=80；rollDie(10)=5 -> 损失 5
    const result = resolveSanityCheck(50, "0", "1d10", queueRng([79, 4]));
    expect(result.success).toBe(false);
    expect(result.roll).toBe(80);
    expect(result.loss).toBe(5);
    expect(result.massive).toBe(true);
    expect(result.sanAfter).toBe(45);
  });
});

describe("疯狂发作表", () => {
  it("1D10=9 恐惧症会带惩罚骰并给出 1D10 轮持续时间", async () => {
    const sanity = await import("../sanity");
    const result = sanity.rollMadnessBout({ nextUint32: (() => {
      const queue = [8, 3];
      return () => queue.shift() ?? 0;
    })() });
    expect(result.roll).toBe(9);
    expect(result.entry.name).toBe("恐惧症");
    expect(result.penaltyDice).toBe(1);
    expect(result.rounds).toBe(4);
  });
});
