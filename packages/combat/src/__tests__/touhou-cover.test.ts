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
  declareDp,
  expireCovers,
  resolveDpTurn,
  type CombatParticipantState,
  type CombatState,
  type CoverState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function cover(overrides: Partial<CoverState> = {}): CoverState {
  return {
    name: "石墙",
    level: 0,
    hp: 20,
    maxHp: 20,
    expiresAtRound: null,
    blocksLineOfSight: true,
    ...overrides
  };
}

interface Setup {
  readonly state: CombatState;
  readonly actor: CombatParticipantState;
  readonly e1: CombatParticipantState;
}

function makeCombat(seed: string): Setup {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250, mode: "DP" });
  const derived = computeDerived(touhou, { attributes: attrs }).derived;
  const build = (id: string, faction: string, kind: "PLAYER" | "NPC", skills: Record<string, number>) =>
    addParticipant(state, {
      id,
      name: id,
      kind,
      characterId: kind === "PLAYER" ? id : null,
      faction,
      attributes: attrs,
      derived,
      skills,
      atbMax: computeAtbMax(touhou, { dex: attrs.dex }),
      speed: computeBaseSpeed(touhou, { dex: attrs.dex })
    });
  const actor = build("actor", "PC", "PLAYER", { DANMAKU: 100 });
  const e1 = build("e1", "BOSS", "NPC", { DANMAKU: 0, DODGE: 0 });
  return { state, actor, e1 };
}

function startRound(state: CombatState, actor: CombatParticipantState, e1: CombatParticipantState): void {
  beginDpRound(touhou, state);
  actor.dp = 30;
  e1.dp = 30;
  declareDp(state, actor.id, 30);
  declareDp(state, e1.id, 0);
}

function ranged(state: CombatState, damage = "2d6+3"): void {
  state.pending["actor"] = {
    actorId: "actor",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "e1",
    skill: "DANMAKU",
    dpDice: 1,
    damage
  };
}

describe("14.5 遮挡物 / 掩体（wiki）", () => {
  it("完整遮挡拦截攻击：只结算固定伤害，本体不受伤", () => {
    const setup = makeCombat("cover-block");
    startRound(setup.state, setup.actor, setup.e1);
    setup.e1.cover = cover({ hp: 20, maxHp: 20, blocksLineOfSight: true });
    ranged(setup.state, "2d6+3"); // 固定值 3
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    expect(setup.e1.hp).toBe(setup.e1.maxHp);
    expect(setup.e1.cover?.hp).toBe(17);
    expect(setup.state.log.some((entry) => entry.data?.rollType === "COVER_HIT")).toBe(true);
    expect(setup.state.log.some((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE")).toBe(false);
  });

  it("遮挡物强度归零被击毁，溢出伤害无效", () => {
    const setup = makeCombat("cover-break");
    startRound(setup.state, setup.actor, setup.e1);
    setup.e1.cover = cover({ hp: 2, maxHp: 2, blocksLineOfSight: true });
    ranged(setup.state, "10");
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    expect(setup.e1.cover).toBeNull();
    expect(setup.e1.hp).toBe(setup.e1.maxHp);
    expect(setup.state.log.some((entry) => entry.data?.rollType === "COVER_BROKEN")).toBe(true);
  });

  it("非完整遮挡 / 无耐久时只提供应对加值", () => {
    const setup = makeCombat("cover-defense");
    startRound(setup.state, setup.actor, setup.e1);
    setup.e1.cover = cover({ level: 15, hp: 0, maxHp: 0, blocksLineOfSight: false });
    ranged(setup.state, "10");
    resolveDpTurn(touhou, setup.state, { e1: { type: "DODGE", dpDice: 0 } });
    expect(setup.e1.hp).toBe(setup.e1.maxHp);
    expect(setup.state.log.some((entry) => entry.data?.rollType === "DP_RANGED_MISS")).toBe(true);
  });

  it("到期掩体在新一轮开始时清除", () => {
    const setup = makeCombat("cover-expire");
    const { state, e1 } = setup;
    state.round = 3;
    e1.cover = cover({ expiresAtRound: 3, hp: 5, maxHp: 5 });
    const expired = expireCovers(state);
    expect(expired).toEqual(["e1"]);
    expect(e1.cover).toBeNull();
    expect(state.log.some((entry) => entry.data?.rollType === "COVER_EXPIRED")).toBe(true);
  });
});
