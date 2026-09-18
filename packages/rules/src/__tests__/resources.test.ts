import { describe, expect, it } from "vitest";
import { spendMagicPoints } from "../resources";

describe("spendMagicPoints", () => {
  it("MP 足够时只扣 MP", () => {
    const result = spendMagicPoints(10, 10, 3, { overflowToHp: true, hpPerMp: 1 });
    expect(result).toMatchObject({ allowed: true, mpAfter: 7, hpLoss: 0, shortfall: 0 });
  });

  it("MP 不足时缺口转扣 HP", () => {
    const result = spendMagicPoints(2, 10, 5, { overflowToHp: true, hpPerMp: 1 });
    expect(result).toMatchObject({ allowed: true, mpAfter: 0, hpLoss: 3, shortfall: 3 });
  });

  it("hpPerMp 大于 1 时按倍率扣 HP", () => {
    const result = spendMagicPoints(2, 10, 5, { overflowToHp: true, hpPerMp: 2 });
    expect(result.hpLoss).toBe(6);
  });

  it("不允许透支时直接拒绝", () => {
    const result = spendMagicPoints(2, 10, 5, { overflowToHp: false, hpPerMp: 1 });
    expect(result.allowed).toBe(false);
    expect(result.mpAfter).toBe(2);
    expect(result.hpLoss).toBe(0);
  });

  it("HP 也不足时拒绝", () => {
    const result = spendMagicPoints(2, 2, 5, { overflowToHp: true, hpPerMp: 1 });
    expect(result.allowed).toBe(false);
  });
});
