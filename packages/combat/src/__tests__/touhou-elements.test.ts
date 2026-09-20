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
  createCombat,
  resolvePending,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function bigDerived() {
  const base = computeDerived(touhou, { attributes: attrs }).derived;
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
    skills: { DANMAKU: 100, MAGIC: 100, DODGE: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }),
    speed: computeBaseSpeed(touhou, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

function attackElement(seed: string, element: string, targetElements: readonly string[]): {
  readonly target: CombatParticipantState;
  readonly steps: string;
} {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250 });
  const attacker = addUnit(state, "attacker", "PC");
  const target = addUnit(state, "target", "BOSS", { elements: [...targetElements] });
  forceReady(attacker);
  forceReady(target);
  submitAction(state, {
    actorId: "attacker",
    kind: "DANMAKU",
    targetId: "target",
    skill: "DANMAKU",
    damage: "20",
    element
  });
  resolvePending(touhou, state, { target: { type: "PASS" } });
  const settle = state.log.find((entry) => entry.data?.rollType === "DAMAGE_SETTLE");
  return { target, steps: String(settle?.data?.steps ?? "") };
}

function dodgeTargetAgainst(seed: string, element: string, targetElements: readonly string[]): number {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250 });
  const attacker = addUnit(state, "attacker", "PC");
  const target = addUnit(state, "target", "BOSS", { elements: [...targetElements] });
  forceReady(attacker);
  forceReady(target);
  submitAction(state, {
    actorId: "attacker", kind: "DANMAKU", targetId: "target", skill: "DANMAKU", damage: "20", element
  });
  resolvePending(touhou, state, { target: { type: "DODGE", skill: "DODGE" } });
  const dodge = state.log.find((entry) => entry.data?.rollType === "DODGE");
  return Number(dodge?.data?.target ?? Number.NaN);
}

describe("属性相克 · 抵抗修正（应对检定目标）", () => {
  it("弱点属性使防守方应对目标 -3", () => {
    expect(dodgeTargetAgainst("resist-weak", "WATER", ["FIRE"])).toBe(97);
  });

  it("同属性使防守方应对目标 +3", () => {
    expect(dodgeTargetAgainst("resist-same", "FIRE", ["FIRE"])).toBe(103);
  });

  it("无元素关系时不修正应对目标", () => {
    expect(dodgeTargetAgainst("resist-none", "WATER", [])).toBe(100);
  });
});

describe("属性相克 · 弱点与同属性", () => {
  it("水属性攻击火属性目标时附加 2d6 弱点伤害", () => {
    const { target, steps } = attackElement("elem-weak", "WATER", ["FIRE"]);
    // 基础 20 + 2d6(2~12) => 损失 22~32
    expect(target.hp).toBeLessThanOrEqual(78);
    expect(target.hp).toBeGreaterThanOrEqual(68);
    expect(steps).toContain("element +");
  });

  it("同属性攻击附加 -2d6 伤害惩罚", () => {
    const { target, steps } = attackElement("elem-same", "FIRE", ["FIRE"]);
    // 基础 20 - 2d6(2~12) => 损失 8~18
    expect(target.hp).toBeLessThanOrEqual(92);
    expect(target.hp).toBeGreaterThanOrEqual(82);
    expect(steps).toContain("element -");
  });

  it("弱点与同属性同时成立时取弱点，不叠加", () => {
    // WATER 克制 FIRE，同时目标也是 WATER：按千幻抄不重复叠加，只算弱点 +2D。
    const { target, steps } = attackElement("elem-both", "WATER", ["FIRE", "WATER"]);
    expect(target.hp).toBeLessThanOrEqual(78);
    expect(target.hp).toBeGreaterThanOrEqual(68);
    expect(steps).toContain("element +");
    expect(steps).not.toContain("element -");
  });

  it("目标没有元素时不应用属性相克", () => {
    const { target, steps } = attackElement("elem-none", "WATER", []);
    expect(target.hp).toBe(80);
    expect(steps).not.toContain("element ");
  });

  it("攻击没有元素时不应用属性相克", () => {
    const state = createCombat({ id: "c-elem-noattack", seed: "elem-noattack", tickMs: 250 });
    const attacker = addUnit(state, "attacker", "PC");
    const target = addUnit(state, "target", "BOSS", { elements: ["FIRE"] });
    forceReady(attacker);
    forceReady(target);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "target", skill: "DANMAKU", damage: "20"
    });
    resolvePending(touhou, state, { target: { type: "PASS" } });
    expect(target.hp).toBe(80);
  });
});
