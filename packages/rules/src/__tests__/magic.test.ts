import { describe, expect, it } from "vitest";
import { MagicSpellSchema } from "../schema";
import { isHostileSpell, spellEffectsOf, spellTargeting } from "../magic";

function spellOf(input: Record<string, unknown>) {
  return MagicSpellSchema.parse({ id: "spell", name: "测试法术", ...input });
}

describe("法术通用指令", () => {
  it("旧 damage 字段等价于一个 DAMAGE 指令", () => {
    const spell = spellOf({ damage: "2d6" });
    expect(spellEffectsOf(spell)).toEqual([{ type: "DAMAGE", amount: "2d6" }]);
  });

  it("可以组合多个效果指令", () => {
    const spell = spellOf({
      effects: [
        { type: "DAMAGE", amount: "1d6" },
        { type: "DOT", amount: "1d3", durationTicks: "3" },
        { type: "STUN", durationActions: "1" }
      ]
    });
    expect(spellEffectsOf(spell).map((effect) => effect.type)).toEqual(["DAMAGE", "DOT", "STUN"]);
  });

  it("按效果推断目标阵营", () => {
    expect(spellTargeting(spellOf({ effects: [{ type: "DAMAGE", amount: "1d6" }] }))).toBe("ENEMY");
    expect(spellTargeting(spellOf({ effects: [{ type: "HEAL", amount: "1d6" }] }))).toBe("ALLY");
    expect(spellTargeting(spellOf({ target: "SELF", effects: [{ type: "HEAL", amount: "1d6" }] }))).toBe("SELF");
    expect(spellTargeting(spellOf({
      effects: [
        { type: "DAMAGE", amount: "1d6" },
        { type: "HEAL", amount: "1d6" }
      ]
    }))).toBe("ANY");
  });

  it("敌对判定只针对攻击性效果", () => {
    expect(isHostileSpell(spellOf({ effects: [{ type: "DOT", amount: "1d3", durationTicks: "2" }] }))).toBe(true);
    expect(isHostileSpell(spellOf({ effects: [{ type: "HEAL", amount: "1d3" }] }))).toBe(false);
  });
});
