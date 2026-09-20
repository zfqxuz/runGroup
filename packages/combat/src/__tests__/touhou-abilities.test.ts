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
