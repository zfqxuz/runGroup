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
    skills: { DANMAKU: 100, MAGIC: 100, MELEE: 100, DODGE: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }),
    speed: computeBaseSpeed(touhou, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

function newCombat(seed: string): CombatState {
  return createCombat({ id: "c-" + seed, seed, tickMs: 250 });
}

describe("种族自动化能力：弱点", () => {
  it("妖怪受到魔法攻击时伤害提高 50%", () => {
    const state = newCombat("youkai-magic");
    const attacker = addUnit(state, "attacker", "PC");
    const youkai = addUnit(state, "youkai", "BOSS", {
      race: "YOUKAI",
      raceFlags: ["WEAK_TO_MAGIC", "WEAK_TO_SPIRIT"]
    });
    forceReady(attacker);
    forceReady(youkai);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "youkai", skill: "MAGIC", damage: "4"
    });
    resolvePending(touhou, state, { youkai: { type: "PASS" } });
    expect(youkai.maxHp).toBe(100);
    expect(youkai.hp).toBe(94);
    expect(
      state.log.some((entry) => String(entry.data?.steps ?? "").includes("race/元素 x1.5"))
    ).toBe(true);
  });

  it("妖怪受到普通攻击时不被误伤加成", () => {
    const state = newCombat("youkai-normal");
    const attacker = addUnit(state, "attacker", "PC");
    const youkai = addUnit(state, "youkai", "BOSS", { race: "YOUKAI" });
    forceReady(attacker);
    forceReady(youkai);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "youkai", skill: "DANMAKU", damage: "4"
    });
    resolvePending(touhou, state, { youkai: { type: "PASS" } });
    expect(youkai.hp).toBe(96);
  });

  it("吸血鬼暴露在 SUNLIGHT 状态下时伤害提高 50%", () => {
    const state = newCombat("vampire-sun");
    const attacker = addUnit(state, "attacker", "PC");
    const vampire = addUnit(state, "vampire", "BOSS", {
      race: "VAMPIRE",
      raceFlags: ["VAMPIRE_WEAKNESS", "CAN_YOUJUTSU"]
    });
    vampire.statusEffects.push({ key: "SUNLIGHT", stacks: 1, remainingTicks: 100 });
    forceReady(attacker);
    forceReady(vampire);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "vampire", skill: "DANMAKU", damage: "4"
    });
    resolvePending(touhou, state, { vampire: { type: "PASS" } });
    expect(vampire.hp).toBe(94);
  });

  it("无种族单位不触发任何弱点", () => {
    const state = newCombat("no-race");
    const attacker = addUnit(state, "attacker", "PC");
    const target = addUnit(state, "target", "BOSS", { race: null });
    forceReady(attacker);
    forceReady(target);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "target", skill: "MAGIC", damage: "4"
    });
    resolvePending(touhou, state, { target: { type: "PASS" } });
    expect(target.hp).toBe(96);
  });
});

describe("种族自动化能力：再生与不死", () => {
  it("怪异每轮开始自动回复 2 HP", () => {
    const state = newCombat("aberrance-regen");
    const aberration = addUnit(state, "ab", "BOSS", {
      race: "ABERRATION",
      raceFlags: ["CAN_ELEMENTALIST", "REGENERATE"]
    });
    aberration.hp = 80;
    resolvePending(touhou, state);
    expect(aberration.maxHp).toBe(100);
    expect(aberration.hp).toBe(82);
    expect(state.log.some((entry) => entry.text.includes("再生"))).toBe(true);
  });

  it("蓬莱人 HP 归零时保留 1 HP，不进入死亡流程", () => {
    const state = newCombat("hourai-immortal");
    const attacker = addUnit(state, "attacker", "PC");
    const hourai = addUnit(state, "hourai", "BOSS", {
      race: "HOURAI",
      raceFlags: ["IMMORTAL"]
    });
    forceReady(attacker);
    forceReady(hourai);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "hourai", skill: "DANMAKU", damage: "150"
    });
    resolvePending(touhou, state, { hourai: { type: "PASS" } });
    expect(hourai.hp).toBe(1);
    expect(hourai.dead).toBe(false);
    expect(hourai.dying).toBe(false);
    expect(hourai.defeated).toBe(false);
    expect(state.log.some((entry) => entry.text.includes("不死性"))).toBe(true);
  });

  it("普通种族不会触发不死保护", () => {
    const state = newCombat("mortal");
    const attacker = addUnit(state, "attacker", "PC");
    const target = addUnit(state, "target", "BOSS", { race: "YOUKAI" });
    forceReady(attacker);
    forceReady(target);
    submitAction(state, {
      actorId: "attacker", kind: "DANMAKU", targetId: "target", skill: "DANMAKU", damage: "150"
    });
    resolvePending(touhou, state, { target: { type: "PASS" } });
    expect(target.hp).toBe(0);
    expect(target.defeated).toBe(true);
  });
});
