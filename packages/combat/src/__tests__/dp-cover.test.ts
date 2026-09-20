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
  resolveDpTurn,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

interface Setup {
  readonly state: CombatState;
  readonly actor: CombatParticipantState;
  readonly e1: CombatParticipantState;
  readonly ally: CombatParticipantState;
}

function makeSetup(
  seed: string,
  actorSkills: Record<string, number> = { DANMAKU: 100, DODGE: 100 },
  allySkills: Record<string, number> = { DODGE: 0, DANMAKU: 0 }
): Setup {
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
  const actor = build("actor", "PC", "PLAYER", actorSkills);
  const e1 = build("e1", "BOSS", "NPC", { DODGE: 0, DANMAKU: 0 });
  const ally = build("ally", "BOSS", "NPC", allySkills);
  return { state, actor, e1, ally };
}

function startRound(setup: Setup, actorDp = 30, enemyDp = 30): void {
  beginDpRound(touhou, setup.state);
  setup.actor.dp = actorDp;
  setup.e1.dp = enemyDp;
  setup.ally.dp = enemyDp;
  declareDp(setup.state, "actor", actorDp);
  declareDp(setup.state, "e1", 0);
  declareDp(setup.state, "ally", 0);
}

function shoot(state: CombatState, dpDice = 1, damage = "10"): void {
  state.pending["actor"] = {
    actorId: "actor",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "e1",
    skill: "DANMAKU",
    dpDice,
    damage
  };
}

describe("DP 掩护 / 身代", () => {
  it("掩护成功时由掩护者承受伤害，原目标不受伤", () => {
    // 掩护者回避 100（5 级 + 3D）很容易挡住 DANMAKU 0 级的攻击
    const setup = makeSetup("dp-cover-ok", { DANMAKU: 0, DODGE: 0 }, { DODGE: 100, DANMAKU: 0 });
    const { state, actor, e1, ally } = setup;
    startRound(setup);
    shoot(state, 1, "10");
    resolveDpTurn(touhou, state, { ally: { type: "COVER", coverTargetId: "e1", dpDice: 3 } });
    // e1 未应对、未受伤；ally 消耗 3 DP 并承受 10 伤害
    expect(e1.hp).toBe(e1.maxHp);
    expect(ally.dp).toBe(27);
    expect(ally.hp).toBe(ally.maxHp - 10);
    const cover = state.log.find((entry) => entry.data?.rollType === "DP_COVER");
    expect(cover?.data?.success).toBe(true);
    expect(cover?.data?.coverTargetId).toBe("e1");
    expect(actor.dp).toBe(29);
  });

  it("掩护失败时原目标无减伤承受伤害", () => {
    // 掩护者回避 0，攻击方 DANMAKU 100 + 3D 必中
    const setup = makeSetup("dp-cover-fail", { DANMAKU: 100, DODGE: 0 }, { DODGE: 0, DANMAKU: 0 });
    const { state, e1, ally } = setup;
    startRound(setup);
    shoot(state, 3, "10");
    resolveDpTurn(touhou, state, {
      e1: { type: "DEFEND", skill: "DODGE", dpDice: 3 }, // 即使原目标声明防御，掩护失败也不减伤
      ally: { type: "COVER", coverTargetId: "e1", dpDice: 1 }
    });
    expect(e1.hp).toBe(e1.maxHp - 10);
    expect(ally.hp).toBe(ally.maxHp);
    const cover = state.log.find((entry) => entry.data?.rollType === "DP_COVER");
    expect(cover?.data?.success).toBe(false);
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damage?.data?.reduction).toBe(0);
  });

  it("同一掩护者一轮只能掩护一次，并记为已使用", () => {
    const setup = makeSetup("dp-cover-once", { DANMAKU: 0, DODGE: 0 }, { DODGE: 100, DANMAKU: 0 });
    const { state, ally } = setup;
    startRound(setup);
    shoot(state, 1, "10");
    resolveDpTurn(touhou, state, { ally: { type: "COVER", coverTargetId: "e1", dpDice: 1 } });
    expect(ally.coverUsedThisRound).toBe(true);
    // 下一轮开始时重置
    beginDpRound(touhou, state);
    expect(ally.coverUsedThisRound).toBe(false);
  });

  it("掩护者 DP 不足时不触发掩护，原目标正常应对", () => {
    const setup = makeSetup("dp-cover-poor", { DANMAKU: 0, DODGE: 0 }, { DODGE: 100, DANMAKU: 0 });
    const { state, e1, ally } = setup;
    startRound(setup, 30, 30);
    ally.dp = 0;
    shoot(state, 1, "10");
    resolveDpTurn(touhou, state, { ally: { type: "COVER", coverTargetId: "e1", dpDice: 3 } });
    // 掩护者没 DP，不产生掩护；e1 回避 0 被命中
    expect(ally.dp).toBe(0);
    expect(ally.hp).toBe(ally.maxHp);
    expect(e1.hp).toBe(e1.maxHp - 10);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_COVER")).toBe(false);
  });
});
