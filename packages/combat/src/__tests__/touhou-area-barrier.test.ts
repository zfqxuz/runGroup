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
  areaBarrierForParticipant,
  combatDistanceMeters,
  createCombat,
  participantBarrierPenalty,
  resolveDpActionForActor,
  resolvePending,
  submitAction,
  syncCombatPositions,
  type CombatParticipantState,
  type CombatState
} from "../index";

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

const squareGrid = { width: 700, height: 700, gridSize: 70, gridType: "SQUARE" } as const;

function buildAreaPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "touhou-area-test": {
      schemaVersion: 1,
      id: "touhou-area-test",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      magic: {
        enabled: true,
        system: "TOUHOU",
        spells: [
          {
            id: "area-shield",
            name: "领域测试",
            skill: "MAGIC",
            mpCost: "0",
            sanCost: "0",
            target: "SELF",
            effects: [
              {
                type: "BARRIER",
                hp: "20",
                name: "领域",
                sizeMeters: 2,
                anchor: "AREA",
                durationTicks: "0"
              }
            ]
          },
          {
            id: "area-bolt",
            name: "领域测试弹",
            skill: "MAGIC",
            mpCost: "0",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "5" }]
          }
        ]
      }
    }
  };
  return compileParsedRulePack(resolveRulePack("touhou-area-test", custom));
}

const areaPack = buildAreaPack();
const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

function buildUnit(
  pack: ReturnType<typeof buildAreaPack>,
  state: CombatState,
  id: string,
  faction: string,
  kind: "PLAYER" | "NPC",
  options: Partial<Parameters<typeof addParticipant>[1]> = {}
): CombatParticipantState {
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  const unit = addParticipant(state, {
    id,
    name: id,
    kind,
    characterId: kind === "PLAYER" ? id : null,
    faction,
    attributes: attrs,
    derived: { ...derived, hp: 100, maxHp: 100, mp: 100, maxMp: 100 },
    skills: { MAGIC: 100 },
    atbMax: computeAtbMax(pack, { dex: attrs.dex }),
    speed: computeBaseSpeed(pack, { dex: attrs.dex }),
    ...options
  });
  return unit;
}

describe("7.5 AREA 结界复用房间地图坐标", () => {
  it("AREA 结界以施法者 Token 为圆心，并按距离判定内外", () => {
    const state = createCombat({ id: "area-cast", seed: "area-cast", tickMs: 250 });
    const caster = buildUnit(areaPack, state, "caster", "PC", "PLAYER");
    const inside = buildUnit(areaPack, state, "inside", "BOSS", "NPC");
    const outside = buildUnit(areaPack, state, "outside", "BOSS", "NPC");
    syncCombatPositions(
      state,
      squareGrid,
      new Map([
        ["caster", { x: 0, y: 0 }],
        ["inside", { x: 70, y: 0 }],
        ["outside", { x: 700, y: 0 }]
      ])
    );
    caster.isReady = true;
    expect(submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "area-shield" })).toBe(true);
    resolvePending(areaPack, state, {});

    expect(caster.barrier?.anchor).toBe("AREA");
    expect(caster.barrier?.centerX).toBe(0);
    expect(caster.barrier?.centerY).toBe(0);
    expect(combatDistanceMeters(state, "caster", "inside")).toBeCloseTo(1.524, 3);
    expect(combatDistanceMeters(state, "caster", "outside")).toBeCloseTo(15.24, 1);
    expect(areaBarrierForParticipant(state, "inside")?.name).toBe("领域");
    expect(areaBarrierForParticipant(state, "outside")).toBeNull();
    expect(participantBarrierPenalty(state, inside)).toBe(3);
    expect(participantBarrierPenalty(state, outside)).toBe(0);
  });

  it("AREA 结界替范围内的目标吸收伤害，击破前本体不受伤害", () => {
    const state = createCombat({ id: "area-absorb", seed: "area-absorb", tickMs: 250, mode: "DP" });
    const attacker = buildUnit(touhou, state, "attacker", "PC", "PLAYER");
    const owner = buildUnit(touhou, state, "owner", "PC", "PLAYER");
    const enemy = buildUnit(touhou, state, "enemy", "BOSS", "NPC");
    syncCombatPositions(
      state,
      squareGrid,
      new Map([
        ["attacker", { x: 700, y: 0 }],
        ["owner", { x: 0, y: 0 }],
        ["enemy", { x: 70, y: 0 }]
      ])
    );
    owner.barrier = {
      hp: 20,
      maxHp: 20,
      name: "领域",
      expiresAtRound: null,
      sizeMeters: 2,
      sizeId: "SIZE_2",
      requiredLevel: 1,
      targetValue: 16,
      penalty: 3,
      anchor: "AREA",
      centerX: 0,
      centerY: 0,
      durationHours: 2
    };
    attacker.dp = 30;
    state.dp = { declared: {}, regenBonus: {}, acted: [] };
    state.pending["attacker"] = {
      actorId: "attacker",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "enemy",
      skill: "DANMAKU",
      dpDice: 1,
      damage: "10"
    };
    resolveDpActionForActor(touhou, state, { enemy: { type: "PASS" } }, "attacker");
    expect(enemy.hp).toBe(enemy.maxHp);
    expect(owner.barrier?.hp).toBe(10);
    expect(state.log.some((entry) => entry.data?.rollType === "BARRIER_ABSORB" && entry.data?.anchor === "AREA")).toBe(true);
  });
});
