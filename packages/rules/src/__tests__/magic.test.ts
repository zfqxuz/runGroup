import { describe, expect, it } from "vitest";
import { MAGIC_EFFECT_TYPES, MagicSpellSchema } from "../schema";
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

  it("DISPEL 指令带默认 keys / declaration", () => {
    const spell = spellOf({ effects: [{ type: "DISPEL" }] });
    expect(spellEffectsOf(spell)).toEqual([{ type: "DISPEL", keys: [], declaration: false }]);
    expect(MAGIC_EFFECT_TYPES).toContain("DISPEL");
  });

  it("DAMAGE / HEAL 支持 LvD 与 +Lv 等级缩放", () => {
    const spell = spellOf({
      effects: [
        { type: "DAMAGE", amount: "1d6", levelDice: { die: 6 }, levelBonus: "abilityLv * 2" },
        { type: "HEAL", amount: "1d3", levelDice: { die: 4, perLevel: 2 } }
      ]
    });
    const [damage, heal] = spellEffectsOf(spell);
    expect(damage).toMatchObject({
      type: "DAMAGE",
      levelDice: { die: 6, perLevel: 1 },
      levelBonus: "abilityLv * 2"
    });
    expect(heal).toMatchObject({ type: "HEAL", levelDice: { die: 4, perLevel: 2 } });
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

describe("ATTACK_BUFF 强化攻击指令", () => {
  it("ATTACK_BUFF 带默认 bonusDice / danmakuDamage / uses / durationTicks", () => {
    const spell = spellOf({ effects: [{ type: "ATTACK_BUFF" }] });
    expect(spellEffectsOf(spell)).toEqual([
      { type: "ATTACK_BUFF", bonusDice: "1", danmakuDamage: "0", uses: "1", durationTicks: "0" }
    ]);
    expect(MAGIC_EFFECT_TYPES).toContain("ATTACK_BUFF");
  });
});

describe("ELEMENTAL_WEAPON 武器生成指令", () => {
  it("ELEMENTAL_WEAPON 带默认 damageBonus / durationTicks / canRanged", () => {
    const spell = spellOf({ effects: [{ type: "ELEMENTAL_WEAPON" }] });
    expect(spellEffectsOf(spell)).toEqual([
      { type: "ELEMENTAL_WEAPON", damageBonus: "abilityLv", durationTicks: "0", canRanged: false }
    ]);
    expect(MAGIC_EFFECT_TYPES).toContain("ELEMENTAL_WEAPON");
  });
});

describe("BARRIER 结界指令", () => {
  it("BARRIER 带默认 name / durationTicks", () => {
    const spell = spellOf({ effects: [{ type: "BARRIER", hp: "2d6" }] });
    expect(spellEffectsOf(spell)).toEqual([
      { type: "BARRIER", hp: "2d6", name: "结界", durationTicks: "0", anchor: "SELF" }
    ]);
    expect(MAGIC_EFFECT_TYPES).toContain("BARRIER");
  });
});
