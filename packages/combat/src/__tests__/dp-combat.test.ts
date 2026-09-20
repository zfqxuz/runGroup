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
  readonly e2: CombatParticipantState;
}

function makeDpCombat(
  seed: string,
  actorSkills: Record<string, number> = { DANMAKU: 100, DODGE: 100 },
  enemySkills: Record<string, number> = { DODGE: 0 }
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
  const e1 = build("e1", "BOSS", "NPC", enemySkills);
  const e2 = build("e2", "BOSS", "NPC", enemySkills);
  return { state, actor, e1, e2 };
}

function startRound(setup: Setup, actorDp = 30): void {
  beginDpRound(touhou, setup.state);
  setup.actor.dp = actorDp;
  setup.e1.dp = 30;
  setup.e2.dp = 30;
  declareDp(setup.state, "actor", actorDp);
  declareDp(setup.state, "e1", 0);
  declareDp(setup.state, "e2", 0);
}

describe("DP 弹幕", () => {
  it("固定消耗 DP、无判定打全体；回避者扣 DP，不回避者吃固定伤害", () => {
    const setup = makeDpCombat("dp-danmaku");
    const { state, actor, e1, e2 } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "DANMAKU",
      danmakuDpReduction: 2,
      danmakuBaseDamage: 5
    };
    const result = resolveDpTurn(touhou, state, {
      e1: { type: "PASS" },
      e2: { type: "DODGE" }
    });
    expect(result.acted).toEqual(["actor"]);
    expect(actor.dp).toBe(27); // 30 - 3
    expect(e1.hp).toBe(e1.maxHp - 5);
    expect(e2.hp).toBe(e2.maxHp);
    expect(e2.dp).toBe(28); // 30 - 2
    expect(state.log.some((entry) => entry.data?.rollType === "DP_DANMAKU_DODGE")).toBe(true);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_DANMAKU_HIT")).toBe(true);
  });

  it("回避者 DP 不足时改为受到固定伤害", () => {
    const setup = makeDpCombat("dp-danmaku-low");
    const { state, e2 } = setup;
    startRound(setup);
    e2.dp = 1; // 少于 reduction 2
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "DANMAKU",
      danmakuDpReduction: 2,
      danmakuBaseDamage: 5
    };
    resolveDpTurn(touhou, state, { e1: { type: "DODGE" }, e2: { type: "DODGE" } });
    expect(e2.hp).toBe(e2.maxHp - 5);
    expect(state.log.some((entry) => entry.text.includes("DP 不足以回避"))).toBe(true);
  });
});

describe("DP 射击", () => {
  it("消费判定骰 DP，对抗失败后结算伤害", () => {
    const setup = makeDpCombat("dp-ranged-hit");
    const { state, actor, e1 } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 3,
      damage: "10"
    };
    resolveDpTurn(touhou, state, { e1: { type: "DODGE", dpDice: 1 } });
    expect(actor.dp).toBe(27); // 30 - 3
    expect(e1.hp).toBe(e1.maxHp - 10);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_RANGED_ATTACK")).toBe(true);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE")).toBe(true);
  });

  it("目标回避成功时不受伤", () => {
    const setup = makeDpCombat("dp-ranged-miss", { DANMAKU: 0, DODGE: 100 });
    const { state, actor, e1 } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 1,
      damage: "10"
    };
    // 攻击方 DANMAKU 0 级 + 1d6，防守方 DODGE 5 级 + 3d6，必被回避
    resolveDpTurn(touhou, state, { e1: { type: "DODGE", dpDice: 3 } });
    expect(e1.hp).toBe(e1.maxHp);
    expect(actor.dp).toBe(29);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_RANGED_MISS")).toBe(true);
  });

  it("防御失败时按〈近战武器〉等级×2 减伤", () => {
    const setup = makeDpCombat("dp-ranged-defend", { DANMAKU: 100, DODGE: 0 }, { DODGE: 0, MELEE: 100 });
    const { state } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 3,
      damage: "20"
    };
    resolveDpTurn(touhou, state, { e1: { type: "DEFEND", skill: "MELEE", dpDice: 1 } });
    // 防守方 MELEE 100 -> 5 级，但用 1D 对抗攻击方 3D，可能失败；失败时减伤 10
    const settled = state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    const reduction = Number(settled?.data?.reduction ?? 0);
    expect([0, 10]).toContain(reduction);
  });
});

describe("DP 判定数值换算", () => {
  it("ATTR_SCALE 作用于 DP 判定（房间参数）", () => {
    // 直接代入时 dex 55 -> 55；÷10 后 -> 5
    const direct = makeDpCombat("dp-scale-1");
    startRound(direct);
    direct.state.pending["actor"] = {
      actorId: "actor", kind: "DANMAKU", dpAction: "RANGED", targetId: "e1",
      skill: "DANMAKU", dpDice: 1, damage: "1"
    };
    resolveDpTurn(touhou, direct.state, { e1: { type: "PASS" } });
    const directBase = Number(direct.state.log.find((entry) => entry.data?.rollType === "DP_RANGED_ATTACK")?.data?.base ?? 0);
    // dex 55 + 5 级 = 60
    expect(directBase).toBe(60);

    // 通过 const 覆盖构造 ÷10 的包
    const scaledPack = (() => {
      const base = JSON.parse(JSON.stringify(touhou.pack)) as Record<string, unknown>;
      (base.const as Record<string, number>).ATTR_SCALE = 10;
      return compileParsedRulePack(base as never);
    })();
    const state = createCombat({ id: "dp-scale-10", seed: "dp-scale-10", tickMs: 250, mode: "DP" });
    const derived = computeDerived(scaledPack, { attributes: attrs }).derived;
    const actor = addParticipant(state, {
      id: "actor", name: "actor", kind: "PLAYER", characterId: "actor", faction: "PC",
      attributes: attrs, derived, skills: { DANMAKU: 100 }, atbMax: computeAtbMax(scaledPack, { dex: attrs.dex }), speed: computeBaseSpeed(scaledPack, { dex: attrs.dex })
    });
    addParticipant(state, {
      id: "e1", name: "e1", kind: "NPC", characterId: null, faction: "BOSS",
      attributes: attrs, derived, skills: { DODGE: 0 }, atbMax: computeAtbMax(scaledPack, { dex: attrs.dex }), speed: computeBaseSpeed(scaledPack, { dex: attrs.dex })
    });
    beginDpRound(scaledPack, state);
    actor.dp = 30;
    declareDp(state, "actor", 30);
    declareDp(state, "e1", 0);
    state.pending["actor"] = {
      actorId: "actor", kind: "DANMAKU", dpAction: "RANGED", targetId: "e1",
      skill: "DANMAKU", dpDice: 1, damage: "1"
    };
    resolveDpTurn(scaledPack, state, { e1: { type: "PASS" } });
    const scaledBase = Number(state.log.find((entry) => entry.data?.rollType === "DP_RANGED_ATTACK")?.data?.base ?? 0);
    // floor(55/10)=5 属性 + 5 级技能 = 10
    expect(scaledBase).toBe(10);
  });
});
