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
        dispelNeedsContest: true,
        castRangeMeters: 30,
        resizeMpCost: 2,
        durationHoursPerLevel: 2,
        dodgeSizeDivisor: 2,
        confinementPenalties: [
          { maxMeters: 1, penalty: 8 },
          { maxMeters: 2, penalty: 3 }
        ],
        extended: { sizeStepMeters: 10, requiredLevelPerStep: 1, targetValuePerStep: 2, mpCostPerStep: 2 },
        tiers: [
          { id: "SIZE_2", name: "2m", sizeMeters: 2, requiredLevel: 1, targetValue: 16, mpCost: 4 },
          { id: "SIZE_5", name: "5m", sizeMeters: 5, requiredLevel: 2, targetValue: 18, mpCost: 6 },
          { id: "SIZE_10", name: "10m", sizeMeters: 10, requiredLevel: 3, targetValue: 20, mpCost: 8 }
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
              { type: "BARRIER", hp: "20", name: "五行阵", sizeMeters: 10, durationTicks: "0" }
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
  it("按大小查表得到目标值 / 必要 Lv / 灵力，并保留卡面 HP", () => {
    const state = createCombat({ id: "barrier-cast", seed: "barrier", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC");
    forceReady(caster);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "caster", spellId: "BARRIER_TEST", name: "BARRIER_TEST" });
    resolvePending(barrierPack, state, { caster: { type: "PASS" } });

    expect(caster.barrier?.hp).toBe(20);
    expect(caster.barrier?.sizeMeters).toBe(10);
    expect(caster.barrier?.sizeId).toBe("SIZE_10");
    expect(caster.barrier?.requiredLevel).toBe(3);
    expect(caster.barrier?.targetValue).toBe(20);
    expect(caster.barrier?.penalty).toBe(0);
    expect(caster.mp).toBe(100 - 8); // 表 7.1 的 10m 灵力消耗

    const applied = state.log.find((entry) => entry.data?.rollType === "BARRIER_APPLIED");
    expect(applied?.data?.barrierSizeMeters).toBe(10);
    expect(applied?.data?.barrierRequiredLevel).toBe(3);
    expect(applied?.data?.barrierTargetValue).toBe(20);
    expect(applied?.data?.barrierMpCost).toBe(8);
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
      sizeMeters: 5,
      sizeId: "SIZE_5",
      requiredLevel: 2,
      targetValue: 18,
      penalty: 0,
      anchor: "SELF",
      durationHours: 4
    };
    forceReady(caster);
    forceReady(enemy);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "enemy", spellId: "BARRIER_BREAK", name: "BARRIER_BREAK" });
    resolvePending(barrierPack, state, { enemy: { type: "PASS" } });

    expect(enemy.barrier).toBeNull();
    const dispel = state.log.find((entry) => entry.data?.dispel === true);
    expect(dispel?.data?.brokeBarrier).toBe(true);
    expect(dispel?.data?.barrierTargetValue).toBe(18);
  });
});
