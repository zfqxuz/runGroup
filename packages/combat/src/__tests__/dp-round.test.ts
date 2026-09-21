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
  beginDpRound,
  createCombat,
  currentDpActorId,
  declareDp,
  dpRegenFor,
  dpTurnOrder,
  endDpTurn,
  grantDpWaitBonus,
  skipDefeatedDpActors,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function dpCombat(seed: string): CombatState {
  return createCombat({ id: "dp-" + seed, seed, tickMs: 250, mode: "DP" });
}

function addUnit(state: CombatState, id: string, kind: "PLAYER" | "NPC", faction: string): CombatParticipantState {
  const derived = computeDerived(touhou, { attributes: attrs }).derived;
  return addParticipant(state, {
    id,
    name: id,
    kind,
    characterId: kind === "PLAYER" ? id : null,
    faction,
    attributes: attrs,
    derived,
    skills: { DANMAKU: 50, DODGE: 50 },
    atbMax: computeAtbMax(touhou, { dex: attrs.dex }),
    speed: computeBaseSpeed(touhou, { dex: attrs.dex })
  });
}

describe("DP 回复", () => {
  it("ceil((知性+感觉)/3)，最低 2，且不超过最大 DP", () => {
    const state = dpCombat("regen");
    const unit = addUnit(state, "a", "PLAYER", "PC");
    unit.dp = 0;
    // int 60 + dex 55 => ceil(115/3)=39
    expect(dpRegenFor(touhou, unit)).toBe(Math.min(unit.maxDp, 39));
    unit.dp = unit.maxDp;
    expect(dpRegenFor(touhou, unit)).toBe(0);
    // 待机加成 +2 参与计算
    unit.dp = 0;
    expect(dpRegenFor(touhou, unit, 2)).toBe(Math.min(unit.maxDp, 41));
  });
});

describe("DP 回合与宣言", () => {
  it("开轮回复 DP 并进入宣言阶段", () => {
    const state = dpCombat("begin");
    const a = addUnit(state, "a", "PLAYER", "PC");
    addUnit(state, "enemy", "NPC", "BOSS");
    a.dp = 0;
    beginDpRound(touhou, state);
    expect(state.round).toBe(1);
    expect(state.phase).toBe("DP_DECLARATION");
    expect(a.dp).toBeGreaterThan(0);
  });

  it("声明 DP 后按从高到低排定行动顺序", () => {
    const state = dpCombat("order");
    const a = addUnit(state, "a", "PLAYER", "PC");
    const b = addUnit(state, "b", "PLAYER", "PC");
    const npc = addUnit(state, "npc", "NPC", "BOSS");
    a.dp = 20; b.dp = 20; npc.dp = 30;
    beginDpRound(touhou, state);
    declareDp(state, "a", 10);
    declareDp(state, "b", 20);
    declareDp(state, "npc", 30);
    expect(state.phase).toBe("AWAITING_ACTION");
    // NPC 声明 30 最高先手；a=10 最后
    expect(dpTurnOrder(state)).toEqual(["npc", "b", "a"]);
    expect(currentDpActorId(state)).toBe("npc");
  });

  it("同值声明时 PC 先于 NPC", () => {
    const state = dpCombat("tie");
    addUnit(state, "pc", "PLAYER", "PC");
    addUnit(state, "npc", "NPC", "BOSS");
    beginDpRound(touhou, state);
    declareDp(state, "pc", 5);
    declareDp(state, "npc", 5);
    expect(dpTurnOrder(state)).toEqual(["pc", "npc"]);
  });

  it("待机加成在下一轮 DP 回复中生效", () => {
    const state = dpCombat("wait");
    const a = addUnit(state, "a", "PLAYER", "PC");
    addUnit(state, "npc", "NPC", "BOSS");
    beginDpRound(touhou, state);
    declareDp(state, "a", 0);
    declareDp(state, "npc", 0);
    grantDpWaitBonus(state, "a");
    a.dp = 0;
    endDpTurn(touhou, state); // npc -> then round advances
    endDpTurn(touhou, state);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("DP_DECLARATION");
    // 基础 39 + 待机 2 = 41
    expect(a.dp).toBe(Math.min(a.maxDp, 41));
  });
});


describe("倒地的行动者不会再卡住 DP 回合", () => {
  it("skipDefeatedDpActors 会把指针推到下一个存活单位", () => {
    const state = dpCombat("skip-dead");
    const pc = addUnit(state, "pc", "PLAYER", "PC");
    const npc = addUnit(state, "npc", "NPC", "BOSS");
    pc.dp = 10;
    npc.dp = 30;
    beginDpRound(touhou, state);
    declareDp(state, "pc", 10);
    declareDp(state, "npc", 30);
    expect(currentDpActorId(state)).toBe("npc");

    npc.defeated = true;
    npc.isReady = false;
    expect(skipDefeatedDpActors(state)).toBe(true);
    expect(currentDpActorId(state)).toBe("pc");
  });

  it("当前行动者在本轮中途死亡并走完顺序后，只剩一个阵营会直接结束战斗", () => {
    const state = dpCombat("dead-round-end");
    const pc = addUnit(state, "pc", "PLAYER", "PC");
    const npc = addUnit(state, "npc", "NPC", "BOSS");
    pc.dp = 10;
    npc.dp = 20;
    beginDpRound(touhou, state);
    declareDp(state, "pc", 10);
    declareDp(state, "npc", 20);
    expect(currentDpActorId(state)).toBe("npc");

    // NPC 还没行动就被打死了：跳过它，轮到 PC；PC 行动结束后本轮走完。
    npc.defeated = true;
    npc.isReady = false;
    expect(skipDefeatedDpActors(state)).toBe(true);
    expect(currentDpActorId(state)).toBe("pc");
    const result = endDpTurn(touhou, state);
    expect(result.roundAdvanced).toBe(true);
    expect(state.phase).toBe("ENDED");
  });

  it("只剩一个阵营时 beginDpRound 不再开新轮，直接结束", () => {
    const state = dpCombat("one-faction");
    addUnit(state, "pc", "PLAYER", "PC");
    const npc = addUnit(state, "npc", "NPC", "BOSS");
    npc.defeated = true;
    beginDpRound(touhou, state);
    expect(state.phase).toBe("ENDED");
  });
});
