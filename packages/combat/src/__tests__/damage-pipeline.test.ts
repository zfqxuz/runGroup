import { describe, expect, it } from "vitest";
import {
  applyDamagePipeline,
  builtinRegistry,
  compileParsedRulePack,
  resolveRulePack
} from "@touhou/rules";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

describe("COC7 伤害管线", () => {
  it("无应对时 1 点基础伤害保持 1", () => {
    const outcome = applyDamagePipeline(coc7, { baseDamage: 1, defense: "PASS" });
    expect(outcome.damage).toBe(1);
  });

  it("闪避成功时伤害归零", () => {
    const outcome = applyDamagePipeline(coc7, {
      baseDamage: 6,
      defense: "DODGE",
      defenseSuccess: true
    });
    expect(outcome.damage).toBe(0);
  });

  it("任意减伤倍率把伤害压到 0~1 之间时，至少保留 1 点", () => {
    const base = resolveRulePack("coc7-baseline", builtinRegistry());
    const halfPack = compileParsedRulePack({
      ...base,
      damage: {
        ...base.damage,
        counter: { cost: "0", failDamageRatio: "0.5" }
      }
    });
    const outcome = applyDamagePipeline(halfPack, {
      baseDamage: 1,
      defense: "COUNTER",
      defenseSuccess: false
    });
    expect(outcome.damage).toBe(1);
  });

  it("反击失败时不应把 1d6=1 再减半成 0", () => {
    const outcome = applyDamagePipeline(coc7, {
      baseDamage: 1,
      defense: "COUNTER",
      defenseSuccess: false
    });
    expect(outcome.damage).toBe(1);
    expect(outcome.steps.some((step) => step.includes("counter fail"))).toBe(true);
  });
});
