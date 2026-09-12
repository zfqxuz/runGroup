import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import {
  addParticipant,
  chaseEndTurn,
  chaseMove,
  createCombat,
  startChase
} from "../index";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const baseAttrs: AttributeSet = {
  str: 50, con: 50, siz: 50, dex: 80,
  app: 50, int: 50, pow: 50, edu: 50, luck: 50
};

function makeChaseState(preyDex = 80) {
  const state = createCombat({ id: "chase-test", seed: "chase-seed", tickMs: 250, mode: "INITIATIVE" });
  const derived = computeDerived(coc7, { attributes: baseAttrs }).derived;
  const prey = addParticipant(state, {
    id: "prey", name: "哈维", kind: "PLAYER", characterId: "char-prey", faction: "PC",
    attributes: { ...baseAttrs, dex: preyDex }, derived, skills: {},
    atbMax: 0, speed: 0
  });
  const chaser = addParticipant(state, {
    id: "chaser", name: "农夫", kind: "NPC", characterId: null, faction: "NPC",
    attributes: { ...baseAttrs, dex: 40 }, derived, skills: {},
    atbMax: 0, speed: 0
  });
  return { state, prey, chaser };
}

describe("COC7 追逐", () => {
  it("速度检定调整 MOV，并按相对 MOV 设置初始位置与行动点", () => {
    const { state, prey, chaser } = makeChaseState();
    const result = startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    expect(result.ok).toBe(true);
    expect(result.escapedImmediately).toBeUndefined();
    const chase = state.chase;
    expect(chase).not.toBeNull();
    if (chase === null) return;
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
    expect(preyEntry?.mov).toBe(7);
    expect(chaserEntry?.mov).toBe(8);
    expect(chaserEntry?.position).toBe(0);
    expect(preyEntry?.position).toBe(2);
    expect(preyEntry?.maxActionPoints).toBe(1);
    expect(chaserEntry?.maxActionPoints).toBe(2);
    expect(chase.order[0]).toBe("prey");
  });

  it("逃离者调整后 MOV 高于最快追逐者时直接逃离", () => {
    const { state, prey, chaser } = makeChaseState();
    const result = startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      speedRolls: { prey: 1, chaser: 100 }
    });
    expect(result.ok).toBe(true);
    expect(result.escapedImmediately).toBe(true);
    expect(state.chase).toBeNull();
  });

  it("移动消耗行动点；逃离者到达终点即逃脱", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 6,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    expect(chase).not.toBeNull();
    if (chase === null) return;
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    if (preyEntry === undefined) throw new Error("missing prey");
    preyEntry.actionPoints = 99;
    const escaped = chaseMove(state, prey.id, chase.trackLength - 1);
    expect(escaped.ok).toBe(true);
    expect(escaped.escaped).toBe(true);
    expect(chase.status).toBe("ESCAPED");
  });

  it("一轮结束后重置行动点并轮转顺序", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    if (chase === null) throw new Error("missing chase");
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
    if (preyEntry === undefined || chaserEntry === undefined) throw new Error("missing participant");
    expect(preyEntry.actionPoints).toBe(1);
    expect(chaserEntry.actionPoints).toBe(2);
    preyEntry.actionPoints = 3;
    chaseMove(state, prey.id, 1);
    expect(preyEntry.actionPoints).toBe(2);
    const first = chaseEndTurn(state);
    expect(first.ok).toBe(true);
    expect(chase.activeIndex).toBe(1);
    const second = chaseEndTurn(state);
    expect(second.ok).toBe(true);
    expect(second.newRound).toBe(true);
    expect(chase.round).toBe(2);
    expect(preyEntry.actionPoints).toBe(preyEntry.maxActionPoints);
    expect(chaserEntry.actionPoints).toBe(chaserEntry.maxActionPoints);
  });
});
