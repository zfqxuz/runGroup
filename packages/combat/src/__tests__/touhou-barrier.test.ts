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

function buildBarrierPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "touhou-barrier-test": {
      schemaVersion: 1,
      id: "touhou-barrier-test",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      barrier: {
        enabled: true,
        restack: "REPLACE",
        dispelNeedsContest: false,
        sizes: {
          LARGE: {
            id: "LARGE",
            name: "大",
            scopeMeters: "6",
            capacity: 0,
            hpMultiplier: "2",
            mpMultiplier: "1",
            penalty: "2"
          }
        },
        levels: [
          { level: 1, hp: "5 + pow", targetValue: "12", mpCost: "4", durationTicks: "3" },
          { level: 3, hp: "10 + pow", targetValue: "16", mpCost: "6", durationTicks: "5" }
        ]
      },
      magic: {
        enabled: true,
        spells: [
          {
            id: "BARRIER_TEST",
            name: "结界·测试",
            skill: "MAGIC",
            mpCost: "0",
            sanCost: "0",
            target: "SELF",
            targeting: "SELF",
            effects: [
              { type: "BARRIER", hp: "1", name: "五行阵", level: 3, size: "LARGE", durationTicks: "0" }
            ]
          },
          {
            id: "BARRIER_BREAK",
            name: "解除·测试",
            skill: "MAGIC",
            mpCost: "0",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DISPEL", keys: ["BARRIER"] }]
          }
        ]
      }
    }
  };
  return compileParsedRulePack(resolveRulePack("touhou-barrier-test", custom));
}

const barrierPack = buildBarrierPack();

function addUnit(
  state: CombatState,
  id: string,
  faction: string,
  options: Partial<Parameters<typeof addParticipant>[1]> = {}
): CombatParticipantState {
  const derived = computeDerived(barrierPack, { attributes: attrs }).derived;
  return addParticipant(state, {
    id,
    name: id,
    kind: "PLAYER",
    characterId: id,
    faction,
    attributes: attrs,
    derived: { ...derived, hp: 100, maxHp: 100, mp: 100, maxMp: 100 },
    skills: { MAGIC: 100, DODGE: 0 },
    atbMax: computeAtbMax(barrierPack, { dex: 55 }),
    speed: computeBaseSpeed(barrierPack, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

describe("7.5 结界表驱动展开 / 解除", () => {
  it("按等级 + 大小查表得到 HP / 目标值 / 持续 / 惩罚，并按表扣灵力", () => {
    const state = createCombat({ id: "barrier-cast", seed: "barrier", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC");
    forceReady(caster);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "caster", spellId: "BARRIER_TEST", name: "BARRIER_TEST" });
    resolvePending(barrierPack, state, { caster: { type: "PASS" } });

    // 等级 3 基础 HP 10 + pow=40 → 50；大 ×2 → 100。灵力 6。
    expect(caster.barrier?.hp).toBe(100);
    expect(caster.barrier?.maxHp).toBe(100);
    expect(caster.barrier?.level).toBe(3);
    expect(caster.barrier?.sizeId).toBe("LARGE");
    expect(caster.barrier?.targetValue).toBe(16);
    expect(caster.barrier?.penalty).toBe(2);
    expect(caster.mp).toBe(100 - 6);

    const applied = state.log.find((entry) => entry.data?.rollType === "BARRIER_APPLIED");
    expect(applied?.data?.barrierLevel).toBe(3);
    expect(applied?.data?.barrierSize).toBe("LARGE");
    expect(applied?.data?.barrierTargetValue).toBe(16);
  });

  it("DISPEL 的 keys 包含 BARRIER 时解除结界", () => {
    const state = createCombat({ id: "barrier-dispel", seed: "dispel", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC");
    const enemy = addUnit(state, "enemy", "BOSS", { faction: "BOSS", skills: { MAGIC: 0, DODGE: 0 } });
    enemy.barrier = {
      hp: 20,
      maxHp: 20,
      name: "敌方结界",
      expiresAtRound: null,
      level: 2,
      sizeId: "LARGE",
      targetValue: 14,
      penalty: 1,
      anchor: "SELF",
      scopeMeters: 6
    };
    forceReady(caster);
    forceReady(enemy);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "enemy", spellId: "BARRIER_BREAK", name: "BARRIER_BREAK" });
    resolvePending(barrierPack, state, { enemy: { type: "PASS" } });

    expect(enemy.barrier).toBeNull();
    const dispel = state.log.find((entry) => entry.data?.dispel === true);
    expect(dispel?.data?.brokeBarrier).toBe(true);
    expect(dispel?.data?.barrierTargetValue).toBe(14);
  });
});
