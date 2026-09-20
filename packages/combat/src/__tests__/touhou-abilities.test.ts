import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet,
  type PackRegistry
} from "@touhou/rules";
import {
  addParticipant,
  createCombat,
  resolvePending,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function buildAbilityPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "touhou-ability-test": {
      schemaVersion: 1,
      id: "touhou-ability-test",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      magic: {
        enabled: true,
        spells: [
          {
            id: "SPIRIT_BOLT",
            name: "灵符·测试",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "SPIRIT_BOLT_HARD",
            name: "灵符·高难",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "999" }
          },
          {
            id: "SPIRIT_BOLT_RESIST",
            name: "灵符·可抵抗",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "1" },
            resist: { attribute: "str", skill: "RESIST", dice: "3D6" }
          },
          {
            id: "SPIRIT_LEVEL_BONUS",
            name: "灵符·等级加值",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4", levelBonus: "abilityLv * 2" }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "SPIRIT_LEVEL_DICE",
            name: "灵符·等级骰",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4", levelDice: { die: 6, perLevel: 1 } }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "SPIRIT_DISPEL",
            name: "灵符·驱散",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ANY",
            effects: [{ type: "DISPEL", keys: ["HASTE"], declaration: true }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "SPIRIT_DISPEL_ALL",
            name: "灵符·大驱散",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ANY",
            effects: [{ type: "DISPEL", keys: [] }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "BARRIER_SPELL",
            name: "结界·测试",
            mpCost: "5",
            sanCost: "0",
            target: "SELF",
            targeting: "SELF",
            effects: [{ type: "BARRIER", hp: "10", name: "测试结界", durationTicks: "0" }]
          },
          {
            id: "ELEMENT_BOLT",
            name: "属性使·火",
            abilityId: "ELEMENTALIST:FIRE",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "PLAIN_LEVEL_BONUS",
            name: "普通法术·等级加值",
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4", levelBonus: "abilityLv * 2" }]
          },
          {
            id: "ELEMENT_GRANT",
            name: "属性赋予·测试",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ALLY",
            effects: [{ type: "ELEMENT_BUFF", element: "WATER", durationTicks: "0" }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          }
        ]
      }
    }
  };
  return compileParsedRulePack(resolveRulePack("touhou-ability-test", custom));
}

const abilityPack = buildAbilityPack();

function bigDerived() {
  const base = computeDerived(abilityPack, { attributes: attrs }).derived;
  return { ...base, hp: 100, maxHp: 100 };
}

function addUnit(
  state: CombatState,
  id: string,
  faction: string,
  options: Partial<Parameters<typeof addParticipant>[1]> = {}
): CombatParticipantState {
  return addParticipant(state, {
    id,
    name: id,
    kind: "PLAYER",
    characterId: id,
    faction,
    attributes: attrs,
    derived: bigDerived(),
    skills: { DANMAKU: 100, DODGE: 100, RESIST: 0 },
    atbMax: computeAtbMax(abilityPack, { dex: 55 }),
    speed: computeBaseSpeed(abilityPack, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

interface CastResult {
  readonly state: CombatState;
  readonly caster: CombatParticipantState;
  readonly target: CombatParticipantState;
}

function castAbility(
  seed: string,
  spellId: string,
  options: {
    readonly casterLevels?: Record<string, number>;
    readonly targetOptions?: Partial<Parameters<typeof addParticipant>[1]>;
  } = {}
): CastResult {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250 });
  const caster = addUnit(state, "caster", "PC", {
    abilityLevels: options.casterLevels ?? { SPIRIT_ARTS: 1 }
  });
  const target = addUnit(state, "target", "BOSS", options.targetOptions ?? {});
  forceReady(caster);
  forceReady(target);
  submitAction(state, {
    actorId: "caster",
    kind: "MAGIC",
    targetId: "target",
    spellId,
    name: spellId
  });
  resolvePending(abilityPack, state, { target: { type: "PASS" } });
  return { state, caster, target };
}

describe("千幻抄能力发动", () => {
  it("已习得且发动成功时，复用 MagicEffect 结算伤害并消耗灵力", () => {
    const { state, caster, target } = castAbility("ability-success", "SPIRIT_BOLT");
    expect(caster.mp).toBe(caster.maxMp - 5);
    expect(target.hp).toBe(target.maxHp - 4);
    const activation = state.log.find((entry) => entry.data?.rollType === "ABILITY_ACTIVATION");
    expect(activation?.data?.success).toBe(true);
  });

  it("发动失败也消耗灵力，但不结算效果", () => {
    const { state, caster, target } = castAbility("ability-fail", "SPIRIT_BOLT_HARD");
    expect(caster.mp).toBe(caster.maxMp - 5);
    expect(target.hp).toBe(target.maxHp);
    expect(state.log.some((entry) => entry.text.includes("发动") && entry.text.includes("失败"))).toBe(true);
  });

  it("未达到所需能力等级时无法发动，也不消耗灵力", () => {
    const { state, caster, target } = castAbility("ability-level", "SPIRIT_BOLT", {
      casterLevels: { SPIRIT_ARTS: 0 }
    });
    expect(caster.mp).toBe(caster.maxMp);
    expect(target.hp).toBe(target.maxHp);
    expect(state.log.some((entry) => String(entry.data?.rollType ?? "") === "ABILITY_LEARN")).toBe(true);
  });

  it("目标抵抗成功时效果被无效化，但施术者仍消耗灵力", () => {
    const { state, caster, target } = castAbility("ability-resist", "SPIRIT_BOLT_RESIST", {
      targetOptions: {
        attributes: { ...attrs, str: 100 },
        skills: { DANMAKU: 100, DODGE: 100, RESIST: 100 }
      }
    });
    expect(caster.mp).toBe(caster.maxMp - 5);
    expect(target.hp).toBe(target.maxHp);
    expect(state.log.some((entry) => entry.text.includes("抵抗成功"))).toBe(true);
  });

  it("目标抵抗失败时正常结算效果", () => {
    const { target } = castAbility("ability-resist-fail", "SPIRIT_BOLT_RESIST", {
      targetOptions: {
        attributes: { ...attrs, str: 0 },
        skills: { DANMAKU: 100, DODGE: 100, RESIST: 0 }
      }
    });
    expect(target.hp).toBe(target.maxHp - 4);
  });
});

describe("能力等级缩放（LvD / +Lv）", () => {
  it("levelBonus 按能力等级追加固定值", () => {
    const { target } = castAbility("ability-level-bonus", "SPIRIT_LEVEL_BONUS", {
      casterLevels: { SPIRIT_ARTS: 3 }
    });
    // 4 + Lv3×2 = 10
    expect(target.hp).toBe(target.maxHp - 10);
  });

  it("levelDice 每级追加 1 颗骰（Lv3 ⇒ 3d6）", () => {
    const { target } = castAbility("ability-level-dice", "SPIRIT_LEVEL_DICE", {
      casterLevels: { SPIRIT_ARTS: 3 }
    });
    // 4 + 3d6(3~18) => 损失 7~22
    expect(target.hp).toBeLessThanOrEqual(target.maxHp - 7);
    expect(target.hp).toBeGreaterThanOrEqual(target.maxHp - 22);
  });

  it("普通魔法路径没有 abilityLevel，levelBonus 不生效", () => {
    // PLAIN_LEVEL_BONUS 没有 abilityId，走 resolveMagic，submission.abilityLevel 为空。
    const state = createCombat({ id: "c-no-level", seed: "ability-no-level", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", { abilityLevels: { SPIRIT_ARTS: 99 } });
    const target = addUnit(state, "target", "BOSS", {});
    forceReady(caster);
    forceReady(target);
    submitAction(state, {
      actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "PLAIN_LEVEL_BONUS"
    });
    resolvePending(abilityPack, state, { target: { type: "PASS" } });
    expect(target.hp).toBe(target.maxHp - 4);
  });
});

describe("DISPEL 驱散", () => {
  it("按 key 驱散状态并击破展开中的符卡", () => {
    const state = createCombat({ id: "c-dispel", seed: "ability-dispel", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", { abilityLevels: { SPIRIT_ARTS: 1 } });
    const target = addUnit(state, "target", "BOSS", {});
    target.statusEffects.push(
      { key: "HASTE", stacks: 1, remainingTicks: 100 },
      { key: "SHIELD", stacks: 1, remainingTicks: 100 }
    );
    target.declaration = {
      name: "测试符卡",
      hp: 10,
      maxHp: 10,
      expiresAtTick: 9999,
      clearTargets: "ALL",
      cardId: null,
      damageMultiplier: 1,
      enhanceType: null,
      enhanceValue: 1
    };
    forceReady(caster);
    forceReady(target);
    submitAction(state, {
      actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "SPIRIT_DISPEL"
    });
    resolvePending(abilityPack, state, { target: { type: "PASS" } });
    expect(target.statusEffects.some((effect) => effect.key === "HASTE")).toBe(false);
    expect(target.statusEffects.some((effect) => effect.key === "SHIELD")).toBe(true);
    expect(target.declaration).toBeNull();
    expect(state.log.some((entry) => entry.text.includes("驱散"))).toBe(true);
  });

  it("keys 为空时驱散全部状态", () => {
    const state = createCombat({ id: "c-dispel-all", seed: "ability-dispel-all", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", { abilityLevels: { SPIRIT_ARTS: 1 } });
    const target = addUnit(state, "target", "BOSS", {});
    target.statusEffects.push(
      { key: "HASTE", stacks: 1, remainingTicks: 100 },
      { key: "SHIELD", stacks: 1, remainingTicks: 100 }
    );
    forceReady(caster);
    forceReady(target);
    submitAction(state, {
      actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "SPIRIT_DISPEL_ALL"
    });
    resolvePending(abilityPack, state, { target: { type: "PASS" } });
    expect(target.statusEffects).toHaveLength(0);
  });
});

describe("属性使能力实例（ELEMENTALIST:SUFFIX）", () => {
  it("按实例 id 读取等级，并用实例指定的发动特性值", () => {
    const state = createCombat({ id: "c-element-instance", seed: "element-instance", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", {
      abilityLevels: { "ELEMENTALIST:FIRE": 2 },
      abilityAttributes: { "ELEMENTALIST:FIRE": "dex" }
    });
    const target = addUnit(state, "target", "BOSS", {});
    forceReady(caster);
    forceReady(target);
    submitAction(state, {
      actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "ELEMENT_BOLT", name: "ELEMENT_BOLT"
    });
    resolvePending(abilityPack, state, { target: { type: "PASS" } });
    const activation = state.log.find((entry) => entry.data?.rollType === "ABILITY_ACTIVATION");
    expect(activation?.data?.success).toBe(true);
    // 属性使默认 {知性}=60；实例指定 {感觉}=DEX 55；此处只验证发动成功且等级被读取。
    expect(activation?.data?.abilityId).toBe("ELEMENTALIST:FIRE");
    expect(activation?.data?.level).toBe(2);
    expect(target.hp).toBe(target.maxHp - 4);
  });
});

describe("结界法术（BARRIER）", () => {
  it("施放后为目标建立结界", () => {
    const { state, caster } = castAbility("barrier-spell", "BARRIER_SPELL");
    expect(caster.barrier).not.toBeNull();
    expect(caster.barrier?.hp).toBe(10);
    expect(caster.barrier?.name).toBe("测试结界");
    expect(state.log.some((entry) => entry.data?.rollType === "BARRIER_APPLIED")).toBe(true);
  });
});

describe("属性赋予（ELEMENT_BUFF）", () => {
  it("给目标授予攻击元素", () => {
    const { target } = castAbility("element-grant", "ELEMENT_GRANT");
    expect(target.grantedElement).toBe("WATER");
  });
});
