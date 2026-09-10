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
  applyStatus,
  createCombat,
  resolvePending,
  submitAction
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));
const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function run(tickMs: number): string {
  const state = createCombat({ id: "c1", seed: "frame-seed", tickMs });
  const derived = computeDerived(touhou, { attributes: attrs }).derived;
  const a = addParticipant(state, {
    id: "a", name: "A", kind: "PLAYER", characterId: "ca", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }), speed: computeBaseSpeed(touhou, { dex: 55 })
  });
  const b = addParticipant(state, {
    id: "b", name: "B", kind: "PLAYER", characterId: "cb", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }), speed: computeBaseSpeed(touhou, { dex: 55 })
  });
  applyStatus(touhou, state, "a", "HASTE", 1);

  for (let i = 0; i < 20; i += 1) {
    advanceToNextEvent(touhou, state);
    if (state.phase === "ENDED") break;
    if (a.isReady) {
      submitAction(state, {
        actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
      });
    }
    if (b.isReady) submitAction(state, { actorId: "b", kind: "PASS" });
    resolvePending(touhou, state);
  }

  return JSON.stringify({
    tick: state.tick,
    round: state.round,
    speeds: state.participants.map((p) => p.speed),
    statuses: state.participants.map((p) =>
      p.statusEffects.map((e) => `${e.key}:${e.remainingTicks}`)
    ),
    hp: state.participants.map((p) => p.hp),
    log: state.log.map((entry) => entry.text)
  });
}

describe("模拟与帧率无关", () => {
  it("同一条计数序列下，tickMs 不同也必须得到相同的战斗状态", () => {
    expect(run(1000)).toBe(run(250));
  });
});
