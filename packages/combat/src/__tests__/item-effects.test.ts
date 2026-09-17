import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import {
  addParticipant,
  advanceToNextEvent,
  createCombat,
  reactionTargetIdsForAction,
  resolvePending,
  submitAction,
  type CombatState
} from "../index";

const pack = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

interface Bench {
  readonly state: CombatState;
  readonly caster: ReturnType<typeof addParticipant>;
  readonly enemy: ReturnType<typeof addParticipant>;
}

function bench(seed: string): Bench {
  const state = createCombat({ id: seed, seed, tickMs: 250 });
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  const caster = addParticipant(state, {
    id: "caster", name: "使用道具的人", kind: "PLAYER", characterId: "char-a", faction: "PC",
    attributes: attrs, derived, skills: { DODGE: 60 },
    atbMax: computeAtbMax(pack, { dex: 55 }), speed: computeBaseSpeed(pack, { dex: 55 })
  });
  const enemy = addParticipant(state, {
    id: "enemy", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
    attributes: attrs, derived, skills: {},
    atbMax: computeAtbMax(pack, { dex: 50 }), speed: computeBaseSpeed(pack, { dex: 50 })
  });
  return { state, caster, enemy };
}

describe("战斗内使用道具", () => {
  it("SELF 范围的治疗道具只作用于自己，并按 MP 消耗扣蓝", () => {
    const { state, caster } = bench("item-heal");
    caster.hp = 3;
    caster.isReady = true;
    const mpBefore = caster.mp;
    expect(
      submitAction(state, {
        actorId: "caster",
        kind: "ITEM",
        itemCardId: "card-potion",
        name: "治疗药水",
        effects: [{ type: "HEAL", amount: "4" }],
        targeting: "SELF",
        targetScope: "SELF",
        mpCost: 2
      })
    ).toBe(true);
    const result = resolvePending(pack, state, {});
    expect(result.acted).toEqual(["caster"]);
    expect(caster.hp).toBe(7);
    expect(caster.mp).toBe(mpBefore - 2);
    expect(state.log.some((entry) => entry.text.includes("使用") && entry.text.includes("治疗药水"))).toBe(true);
  });

  it("敌方单体伤害道具会进入应对窗口，命中后按伤害管线扣血", () => {
    const { state, enemy } = bench("item-damage");
    advanceToNextEvent(pack, state);
    const action = {
      actorId: "caster",
      kind: "ITEM" as const,
      itemCardId: "card-bomb",
      name: "燃烧瓶",
      effects: [{ type: "DAMAGE" as const, amount: "2d6" }],
      targeting: "ENEMY" as const,
      targetScope: "ONE" as const
    };
    expect(reactionTargetIdsForAction(pack, state, { ...action, targetId: "enemy" })).toEqual(["enemy"]);
    submitAction(state, { ...action, targetId: "enemy" });
    const hpBefore = enemy.hp;
    resolvePending(pack, state, { enemy: { type: "PASS" } });
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(enemy.hp).toBeGreaterThanOrEqual(hpBefore - 12);
  });

  it("群体道具对范围内所有敌方结算", () => {
    const { state, enemy } = bench("item-aoe");
    const second = addParticipant(state, {
      id: "enemy2", name: "妖精乙", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived: computeDerived(pack, { attributes: attrs }).derived, skills: {},
      atbMax: computeAtbMax(pack, { dex: 40 }), speed: computeBaseSpeed(pack, { dex: 40 })
    });
    advanceToNextEvent(pack, state);
    submitAction(state, {
      actorId: "caster",
      kind: "ITEM",
      itemCardId: "card-flask",
      name: "毒雾瓶",
      effects: [{ type: "DAMAGE", amount: "1d4" }],
      targeting: "ENEMY",
      targetScope: "ALL"
    });
    resolvePending(pack, state, { enemy: { type: "PASS" }, enemy2: { type: "PASS" } });
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
  });

  it("战斗内使用道具：残留的状态型 submission 仍按旧行为生效", () => {
    const { state, caster } = bench("item-status");
    caster.isReady = true;
    state.pending.caster = { actorId: "caster", kind: "ITEM", status: { key: "HASTE", stacks: 1 } };
    resolvePending(pack, state, {});
    expect(caster.statusEffects.some((effect) => effect.key === "HASTE")).toBe(true);
  });
});
