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

function buildPack(system: "TOUHOU" | "COC7") {
  const registry = builtinRegistry();
  const base = system === "COC7" ? "coc7-baseline@1.1.0" : "touhou-ext@1.1.0";
  const custom: PackRegistry = {
    ...registry,
    ["mp-exhaustion-" + system.toLowerCase()]: {
      schemaVersion: 1,
      id: "mp-exhaustion-" + system.toLowerCase(),
      system,
      version: "1.0.0",
      extends: [base],
      magic: {
        enabled: true,
        spells: [
          {
            id: "DRAIN_SELF",
            name: "耗尽灵力",
            mpCost: "10",
            sanCost: "0",
            target: "SELF",
            effects: [{ type: "STATUS", key: "HASTE", stacks: "1" }]
          },
          {
            id: "RESTORE_MP",
            name: "回灵",
            mpCost: "0",
            sanCost: "0",
            target: "ONE",
            targeting: "ALLY",
            effects: [{ type: "MP_RESTORE", amount: "5" }]
          }
        ]
      }
    }
  };
  return compileParsedRulePack(resolveRulePack("mp-exhaustion-" + system.toLowerCase(), custom));
}

const touhou = buildPack("TOUHOU");
const coc7 = buildPack("COC7");

function bigDerived(pack: typeof touhou) {
  const base = computeDerived(pack, { attributes: attrs }).derived;
  return { ...base, hp: 100, maxHp: 100 };
}

function addUnit(
  pack: typeof touhou,
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
    derived: bigDerived(pack),
    skills: { DANMAKU: 100, DODGE: 100 },
    atbMax: computeAtbMax(pack, { dex: 55 }),
    speed: computeBaseSpeed(pack, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

describe("千幻抄 14.3 灵力归零昏迷", () => {
  it("TOUHOU：灵力归零即昏迷、失去行动能力", () => {
    const state = createCombat({ id: "c-mp-zero", seed: "mp-zero", tickMs: 250 });
    const caster = addUnit(touhou, state, "caster", "PC");
    addUnit(touhou, state, "enemy", "BOSS");
    caster.mp = 5;
    forceReady(caster);
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "DRAIN_SELF" });
    resolvePending(touhou, state);
    expect(caster.mp).toBe(0);
    expect(caster.mpExhausted).toBe(true);
    expect(caster.defeated).toBe(true);
    expect(state.log.some((entry) => entry.data?.rollType === "MP_EXHAUSTED")).toBe(true);
  });

  it("TOUHOU：队友回灵可唤醒灵力归零者", () => {
    const state = createCombat({ id: "c-mp-wake", seed: "mp-wake", tickMs: 250 });
    const caster = addUnit(touhou, state, "caster", "PC");
    const healer = addUnit(touhou, state, "healer", "PC");
    addUnit(touhou, state, "enemy", "BOSS");
    caster.mp = 5;

    forceReady(caster);
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "DRAIN_SELF" });
    resolvePending(touhou, state);
    expect(caster.defeated).toBe(true);

    forceReady(healer);
    submitAction(state, {
      actorId: "healer", kind: "MAGIC", spellId: "RESTORE_MP", targetId: "caster"
    });
    resolvePending(touhou, state);
    expect(caster.mp).toBe(5);
    expect(caster.mpExhausted).toBe(false);
    expect(caster.defeated).toBe(false);
    expect(state.log.some((entry) => entry.data?.rollType === "MP_RECOVERED")).toBe(true);
  });

  it("COC7：不设置灵力归零昏迷标记", () => {
    const state = createCombat({ id: "c-mp-coc7", seed: "mp-coc7", tickMs: 250 });
    const caster = addUnit(coc7, state, "caster", "PC");
    addUnit(coc7, state, "enemy", "BOSS");
    caster.mp = 100;
    forceReady(caster);
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "DRAIN_SELF" });
    resolvePending(coc7, state);
    expect(caster.mp).toBe(90);
    expect(caster.mpExhausted ?? false).toBe(false);
    expect(state.log.some((entry) => entry.data?.rollType === "MP_EXHAUSTED")).toBe(false);
  });
});
