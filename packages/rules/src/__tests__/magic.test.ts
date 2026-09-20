import { describe, expect, it } from "vitest";
import { MagicSpellSchema } from "../schema";
import { canCastOutsideCombat, isHostileSpell, outOfCombatBlockReason, spellEffectsOf, spellTargeting } from "../magic";

function spellOf(input: Record<string, unknown>) {
  return MagicSpellSchema.parse({ id: "spell", name: "测试法术", ...input });
}

describe("法术通用指令", () => {
  it("旧 damage 字段等价于一个 DAMAGE 指令", () => {
    const spell = spellOf({ damage: "2d6" });
    expect(spellEffectsOf(spell)).toEqual([{ type: "DAMAGE", amount: "2d6" }]);
  });

  it("法术默认元素会写入旧 damage 字段生成的 DAMAGE 指令", () => {
    const spell = spellOf({ damage: "2d6", element: "FIRE" });
    expect(spellEffectsOf(spell)).toEqual([{ type: "DAMAGE", amount: "2d6", element: "FIRE" }]);
  });

  it("效果级元素优先于法术默认元素", () => {
    const spell = spellOf({
      element: "FIRE",
      effects: [{ type: "DAMAGE", amount: "1d6", element: "WATER" }]
    });
    expect(spellEffectsOf(spell)[0]).toMatchObject({ type: "DAMAGE", element: "WATER" });
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
    expect(spellTargeting(spellOf({ effects: [{ type: "ARMOR", amount: "1d6", durationTicks: "0" }] }))).toBe("ALLY");
    expect(spellTargeting(spellOf({ effects: [{ type: "SUMMON", name: "召唤物", count: "1", durationTicks: "0" }] }))).toBe("SELF");
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

describe("战斗外施法判定", () => {
  it("治疗 / 回复 / 护甲 / 状态 / 净化 / 召唤 / 夺舍可以在战斗外施放", () => {
    const spells = [
      spellOf({ effects: [{ type: "HEAL", amount: "1d6" }] }),
      spellOf({ effects: [{ type: "MP_RESTORE", amount: "3" }] }),
      spellOf({ effects: [{ type: "SAN_RESTORE", amount: "3" }] }),
      spellOf({ effects: [{ type: "ARMOR", amount: "2d6", durationTicks: "3" }] }),
      spellOf({ effects: [{ type: "CLEANSE", keys: [] }] }),
      spellOf({ effects: [{ type: "SUMMON", name: "召唤物", count: "1", durationTicks: "0" }] }),
      spellOf({ effects: [{ type: "POSSESS", durationTurns: "3" }] })
    ];
    for (const spell of spells) {
      expect(canCastOutsideCombat(spell), spell.name).toBe(true);
      expect(outOfCombatBlockReason(spell)).toBeNull();
    }
  });

  it("依赖战斗结算的伤害 / 持续伤害 / 吸 MP / 扣 SAN 被阻止", () => {
    for (const effect of [
      { type: "DAMAGE", amount: "1d6" },
      { type: "DOT", amount: "1d3", durationTicks: "3" },
      { type: "MP_DRAIN", amount: "3" },
      { type: "SAN_LOSS", amount: "1d4" }
    ]) {
      const spell = spellOf({ effects: [effect] });
      expect(canCastOutsideCombat(spell)).toBe(false);
      expect(outOfCombatBlockReason(spell)).not.toBeNull();
    }
  });

  it("组合效果只要包含一个战斗专用效果就整体阻止", () => {
    const spell = spellOf({
      effects: [
        { type: "HEAL", amount: "1d6" },
        { type: "DAMAGE", amount: "1d6" }
      ]
    });
    expect(canCastOutsideCombat(spell)).toBe(false);
  });
});
