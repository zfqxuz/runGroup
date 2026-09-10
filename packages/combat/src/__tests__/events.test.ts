import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet,
  type RulePack,
  type CompiledRulePack
} from "@touhou/rules";
import {
  addParticipant,
  createCombat,
  resolvePending,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

interface Setup {
  readonly state: CombatState;
  readonly a: CombatParticipantState;
  readonly b: CombatParticipantState;
  readonly npc: CombatParticipantState;
}

function makeCombat(pack: CompiledRulePack, seed = "event-seed"): Setup {
  const state = createCombat({ id: "events", seed, tickMs: 250 });
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  const vars = { ...attrs, ...derived };
  const atbMax = computeAtbMax(pack, vars);
  const speed = computeBaseSpeed(pack, vars);
  const a = addParticipant(state, {
    id: "a", name: "灵梦", kind: "PLAYER", characterId: "char-a", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100, DODGE: 100 },
    atbMax, speed
  });
  const b = addParticipant(state, {
    id: "b", name: "魔理沙", kind: "PLAYER", characterId: "char-b", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100, DODGE: 100 },
    atbMax, speed
  });
  const npc = addParticipant(state, {
    id: "npc", name: "露米娅", kind: "NPC", characterId: null, faction: "BOSS",
    attributes: attrs, derived, skills: { DANMAKU: 100 },
    atbMax, speed
  });
  return { state, a, b, npc };
}

function forceReady(participant: CombatParticipantState): void {
  participant.isReady = true;
  participant.atbValue = 100000;
}

function disabledPack(eventId: string): CompiledRulePack {
  const pack = structuredClone(resolveRulePack("touhou-ext", builtinRegistry())) as RulePack;
  const event = pack.combat.events[eventId];
  if (event === undefined) throw new Error("missing event " + eventId);
  event.defaultEnabled = false;
  return compileRulePack(pack);
}

describe("战斗事件分派器", () => {
  it("GRAZE 关闭后闪避不再免伤或回灵", () => {
    const pack = disabledPack("GRAZE");
    const { state, a, b } = makeCombat(pack);
    forceReady(a);
    b.mp = 10;
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    resolvePending(pack, state, { b: { type: "DODGE", skill: "DODGE" } });
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(b.mp).toBe(10);
    expect(state.log.some((entry) => entry.text.includes("已被本房禁用"))).toBe(true);
  });

  it("SPELLCARD_BREAK_CLEARS_DANMAKU 关闭后击破符卡不清弹", () => {
    const pack = disabledPack("SPELLCARD_BREAK_CLEARS_DANMAKU");
    const { state, a, b, npc } = makeCombat(pack);
    forceReady(a);
    forceReady(b);
    forceReady(npc);
    submitAction(state, {
      actorId: "a", kind: "SPELLCARD", name: "梦想封印", spellcardMode: "DECLARATION",
      declarationHp: 5, declarationDurationTicks: 240, mpCost: 0
    });
    submitAction(state, {
      actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "1d6+10"
    });
    submitAction(state, {
      actorId: "npc", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "2d6"
    });
    const result = resolvePending(pack, state, { a: { type: "PASS" } });
    expect(result.cleared).not.toContain("npc");
    expect(a.declaration).toBeNull();
  });

  it("OUT_OF_RULE_SPELL 开启时扣除 MP 与 SAN", () => {
    const { state, a } = makeCombat(touhou);
    forceReady(a);
    a.mp = 100;
    a.san = 50;
    submitAction(state, { actorId: "a", kind: "OUT_OF_RULE", name: "禁术" });
    resolvePending(touhou, state);
    expect(a.mp).toBe(80);
    expect(a.san).toBeLessThan(50);
    expect(state.log.some((entry) => entry.text.includes("规则外法术"))).toBe(true);
  });

  it("OUT_OF_RULE_SPELL 关闭时拒绝施法", () => {
    const pack = disabledPack("OUT_OF_RULE_SPELL");
    const { state, a } = makeCombat(pack);
    forceReady(a);
    a.mp = 100;
    a.san = 50;
    submitAction(state, { actorId: "a", kind: "OUT_OF_RULE", name: "禁术" });
    resolvePending(pack, state);
    expect(a.mp).toBe(100);
    expect(a.san).toBe(50);
    expect(state.log.some((entry) => entry.text.includes("已禁用规则外施法"))).toBe(true);
  });
});
