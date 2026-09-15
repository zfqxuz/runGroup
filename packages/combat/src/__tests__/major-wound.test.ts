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
  resolveDyingChecks,
  resolveImmediateAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 50, dex: 50,
  app: 50, int: 50, pow: 50, edu: 50, luck: 50
};

function makePair(): { state: CombatState; attacker: CombatParticipantState; target: CombatParticipantState } {
  const state = createCombat({ id: "coc", seed: "coc-major-wound", tickMs: 250, mode: "INITIATIVE" });
  const attributes = { ...attrs };
  const derived = computeDerived(coc7, { attributes }).derived;
  const attacker = addParticipant(state, {
    id: "attacker", name: "调查员A", kind: "PLAYER", characterId: "char-a", faction: "ALLY",
    attributes, derived, skills: { FIGHTING_BRAWL: 999 }, damageBonus: "0",
    atbMax: computeAtbMax(coc7, { dex: 50 }), speed: computeBaseSpeed(coc7, { dex: 50 })
  });
  const target = addParticipant(state, {
    id: "target", name: "调查员B", kind: "PLAYER", characterId: "char-b", faction: "ALLY",
    attributes, derived, skills: { DODGE: 999 }, damageBonus: "0",
    atbMax: computeAtbMax(coc7, { dex: 50 }), speed: computeBaseSpeed(coc7, { dex: 50 })
  });
  return { state, attacker, target };
}

function hit(targetId: string, damage: string): void {
  const { state } = pair;
  resolveImmediateAction(
    coc7,
    state,
    { actorId: "attacker", kind: "DANMAKU", targetId, skill: "FIGHTING_BRAWL", damage },
    { [targetId]: { type: "PASS" } }
  );
}

let pair = makePair();

describe("COC7 重伤与濒死规则", () => {
  it("规则包提供可开关的重伤 / 濒死事件", () => {
    expect(coc7.combat.events.MAJOR_WOUND?.defaultEnabled).toBe(true);
    expect(coc7.combat.events.DYING?.defaultEnabled).toBe(true);
  });

  it("单次伤害不足最大生命值一半时只是普通受伤", () => {
    pair = makePair();
    hit("target", "4");
    expect(pair.target.hp).toBe(6);
    expect(pair.target.majorWound).toBe(false);
    expect(pair.target.dying).toBe(false);
  });

  it("单次伤害达到最大生命值一半时造成重伤并倒地", () => {
    pair = makePair();
    hit("target", "5");
    expect(pair.target.hp).toBe(5);
    expect(pair.target.majorWound).toBe(true);
    expect(pair.target.prone).toBe(true);
  });

  it("单次伤害达到最大生命值时当场死亡", () => {
    pair = makePair();
    hit("target", "10");
    expect(pair.target.hp).toBe(0);
    expect(pair.target.dead).toBe(true);
    expect(pair.target.defeated).toBe(true);
  });

  it("已受重伤的角色 HP 归零时进入濒死", () => {
    pair = makePair();
    hit("target", "6");
    hit("target", "4");
    expect(pair.target.hp).toBe(0);
    expect(pair.target.majorWound).toBe(true);
    expect(pair.target.dying).toBe(true);
    expect(pair.target.unconscious).toBe(true);
    expect(pair.target.defeated).toBe(true);
  });

  it("未受重伤的角色 HP 归零只会昏迷，不会进入濒死", () => {
    pair = makePair();
    hit("target", "4");
    expect(pair.target.majorWound).toBe(false);
    pair.target.hp = 4;
    hit("target", "4");
    expect(pair.target.hp).toBe(0);
    expect(pair.target.majorWound).toBe(false);
    expect(pair.target.dying).toBe(false);
    expect(pair.target.unconscious).toBe(true);
  });

  it("濒死角色在下一轮结束开始 CON 检定，失败立即死亡", () => {
    pair = makePair();
    hit("target", "6");
    hit("target", "4");
    pair.target.attributes.con = 0;
    pair.target.vars.con = 0;
    pair.target.dyingSinceRound = pair.state.round;
    pair.state.round = pair.target.dyingSinceRound + 2;
    resolveDyingChecks(coc7, pair.state);
    expect(pair.target.dead).toBe(true);
    expect(pair.target.dying).toBe(false);
  });

  it("濒死 CON 检定成功则继续撑住", () => {
    pair = makePair();
    hit("target", "6");
    hit("target", "4");
    pair.target.attributes.con = 999;
    pair.target.vars.con = 999;
    pair.target.dyingSinceRound = pair.state.round;
    pair.state.round = pair.target.dyingSinceRound + 2;
    resolveDyingChecks(coc7, pair.state);
    expect(pair.target.dead).toBe(false);
    expect(pair.target.dying).toBe(true);
  });
});
