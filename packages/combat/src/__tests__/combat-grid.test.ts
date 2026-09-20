import { describe, expect, it } from "vitest";
import {
  combatDistanceFeet,
  combatDistanceMeters,
  createCombat,
  syncCombatPositions,
  type CombatParticipantState,
  type CombatState
} from "../index";

function stateWithUnits(): CombatState {
  const state = createCombat({ id: "grid-test", seed: "grid-test", tickMs: 250 });
  state.participants.push(
    { id: "a" } as unknown as CombatParticipantState,
    { id: "b" } as unknown as CombatParticipantState
  );
  return state;
}

describe("战斗复用房间地图网格", () => {
  it("SQUARE：切比雪夫距离换算英尺 / 米", () => {
    const state = stateWithUnits();
    syncCombatPositions(
      state,
      { width: 700, height: 700, gridSize: 70, gridType: "SQUARE" },
      new Map([
        ["a", { x: 35, y: 35 }],
        ["b", { x: 245, y: 35 }]
      ])
    );
    expect(combatDistanceFeet(state, "a", "b")).toBe(15);
    expect(combatDistanceMeters(state, "a", "b")).toBeCloseTo(4.572, 3);
  });

  it("HEX：轴向距离 1 格 = 5 英尺", () => {
    const state = stateWithUnits();
    const size = 35;
    syncCombatPositions(
      state,
      { width: 700, height: 700, gridSize: 70, gridType: "HEX" },
      new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: size * Math.sqrt(3), y: 0 }]
      ])
    );
    expect(combatDistanceFeet(state, "a", "b")).toBe(5);
  });

  it("NONE：像素欧氏距离换算格数", () => {
    const state = stateWithUnits();
    syncCombatPositions(
      state,
      { width: 700, height: 700, gridSize: 70, gridType: "NONE" },
      new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 140, y: 0 }]
      ])
    );
    expect(combatDistanceFeet(state, "a", "b")).toBe(10);
  });

  it("缺网格 / 缺坐标时返回 null", () => {
    const state = stateWithUnits();
    expect(combatDistanceFeet(state, "a", "b")).toBeNull();
    syncCombatPositions(state, { width: 700, height: 700, gridSize: 70, gridType: "SQUARE" }, new Map([["a", { x: 0, y: 0 }]]));
    expect(combatDistanceFeet(state, "a", "b")).toBeNull();
  });
});
