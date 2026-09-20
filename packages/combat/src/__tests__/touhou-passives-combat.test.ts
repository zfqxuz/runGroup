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
  resolveDpActionForActor,
  resolveDpTurn,
  type CombatPassiveMods,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function passive(overrides: Partial<CombatPassiveMods> = {}): CombatPassiveMods {
  return {
    damageBonus: 0,
    reactionBonus: 0,
    accuracyBonus: 0,
    movementBonus: 0,
    grazeBonusPer: 0,
    danmakuDpReduction: 0,
    danmakuDamageReduction: 0,
    damageDice: 0,
    danmakuDamageBonus: 0,
    ...overrides
  };
}

interface Setup {
  readonly state: CombatState;
  readonly actor: CombatParticipantState;
  readonly e1: CombatParticipantState;
}

function makeCombat(seed: string, actorMods: CombatPassiveMods, enemyMods: CombatPassiveMods): Setup {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250, mode: "DP" });
  const derived = computeDerived(touhou, { attributes: attrs }).derived;
  const build = (
    id: string,
    faction: string,
    kind: "PLAYER" | "NPC",
    skills: Record<string, number>,
    mods: CombatPassiveMods
  ) =>
    addParticipant(state, {
      id,
      name: id,
      kind,
      characterId: kind === "PLAYER" ? id : null,
      faction,
      attributes: attrs,
      derived,
      skills,
      passiveMods: mods,
      atbMax: computeAtbMax(touhou, { dex: attrs.dex }),
      speed: computeBaseSpeed(touhou, { dex: attrs.dex })
    });
  const actor = build("actor", "PC", "PLAYER", { DANMAKU: 100 }, actorMods);
  const e1 = build("e1", "BOSS", "NPC", { DANMAKU: 0, DODGE: 0 }, enemyMods);
  return { state, actor, e1 };
}

function startRound(state: CombatState, actor: CombatParticipantState, e1: CombatParticipantState): void {
  beginDpRound(touhou, state);
  actor.dp = 30;
  e1.dp = 30;
  declareDp(state, actor.id, 30);
  declareDp(state, e1.id, 0);
}

function ranged(state: CombatState, targetId: string, damage: string, dice = 1): void {
  state.pending["actor"] = {
    actorId: "actor",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId,
    skill: "DANMAKU",
    dpDice: dice,
    damage
  };
}

describe("常时被动在 DP 战斗中生效", () => {
  it("damageBonus 直接加到攻击伤害上（同种子对照）", () => {
    const base = makeCombat("passive-dmg-base", passive(), passive({ reactionBonus: -999 }));
    startRound(base.state, base.actor, base.e1);
    ranged(base.state, "e1", "10");
    resolveDpTurn(touhou, base.state, { e1: { type: "PASS" } });
    const baseDamage = base.e1.maxHp - base.e1.hp;

    const boosted = makeCombat("passive-dmg-base", passive({ damageBonus: 25 }), passive({ reactionBonus: -999 }));
    startRound(boosted.state, boosted.actor, boosted.e1);
    ranged(boosted.state, "e1", "10");
    resolveDpTurn(touhou, boosted.state, { e1: { type: "PASS" } });
    const boostedDamage = boosted.e1.maxHp - boosted.e1.hp;

    expect(boostedDamage).toBe(baseDamage + 25);
  });

  it("reactionBonus 能扭转回避结果", () => {
    const without = makeCombat("passive-react", passive(), passive());
    startRound(without.state, without.actor, without.e1);
    ranged(without.state, "e1", "10");
    // e1 DODGE 0 级 + 0 骰，无法回避高技能攻击。
    resolveDpTurn(touhou, without.state, { e1: { type: "DODGE", dpDice: 0 } });
    expect(without.e1.hp).toBeLessThan(without.e1.maxHp);

    const withBonus = makeCombat("passive-react", passive(), passive({ reactionBonus: 30 }));
    startRound(withBonus.state, withBonus.actor, withBonus.e1);
    ranged(withBonus.state, "e1", "10");
    resolveDpTurn(touhou, withBonus.state, { e1: { type: "DODGE", dpDice: 0 } });
    expect(withBonus.e1.hp).toBe(withBonus.e1.maxHp);
    expect(withBonus.state.log.some((entry) => entry.data?.rollType === "DP_RANGED_MISS")).toBe(true);
  });

  it("grazeBonusPer 在成功回避时追加擦弹点（擦弹判定大）", () => {
    const setup = makeCombat("passive-graze", passive(), passive({ grazeBonusPer: 3 }));
    // 让攻击方不命中、防守方用 3 骰稳定回避。
    setup.actor.skills.DANMAKU = 0;
    setup.e1.skills.DODGE = 200;
    startRound(setup.state, setup.actor, setup.e1);
    ranged(setup.state, "e1", "10");
    resolveDpTurn(touhou, setup.state, { e1: { type: "DODGE", dpDice: 3 } });
    // 基础擦弹 = 3 骰 → 3 点；每 3 点额外 +1 → 4 点
    expect(setup.e1.grazePoints).toBe(4);
  });

  it("被弹判定小：降低弹幕回避 DP 消耗（同种子对照）", () => {
    const setup = makeCombat("passive-danmaku-dp", passive(), passive({ danmakuDpReduction: 1 }));
    startRound(setup.state, setup.actor, setup.e1);
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "DANMAKU",
      danmakuDpReduction: 2,
      danmakuBaseDamage: 5
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "DODGE" } });
    const dodge = setup.state.log.find((entry) => entry.data?.rollType === "DP_DANMAKU_DODGE");
    expect(dodge?.data?.reduction).toBe(1);
    expect(setup.e1.dp).toBe(29);
  });

  it("被弹判定小：降低弹幕命中伤害", () => {
    const setup = makeCombat("passive-danmaku-dmg", passive(), passive({ danmakuDamageReduction: 1 }));
    startRound(setup.state, setup.actor, setup.e1);
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "DANMAKU",
      danmakuDpReduction: 2,
      danmakuBaseDamage: 5
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    expect(setup.e1.hp).toBe(setup.e1.maxHp - 4);
  });

  it("damageDice 为射击追加 Nd6 伤害（气功）", () => {
    const base = makeCombat("passive-qigong-dice", passive(), passive({ reactionBonus: -999 }));
    startRound(base.state, base.actor, base.e1);
    ranged(base.state, "e1", "10");
    resolveDpTurn(touhou, base.state, { e1: { type: "PASS" } });
    const baseDamage = base.e1.maxHp - base.e1.hp;

    const boosted = makeCombat("passive-qigong-dice", passive({ damageDice: 3 }), passive({ reactionBonus: -999 }));
    startRound(boosted.state, boosted.actor, boosted.e1);
    ranged(boosted.state, "e1", "10");
    resolveDpTurn(touhou, boosted.state, { e1: { type: "PASS" } });
    const boostedDamage = boosted.e1.maxHp - boosted.e1.hp;

    // 固定 10 点 + 3d6，因此差值在 3~18 之间。
    expect(boostedDamage - baseDamage).toBeGreaterThanOrEqual(3);
    expect(boostedDamage - baseDamage).toBeLessThanOrEqual(18);
  });

  it("danmakuDamageBonus 为弹幕追加固定伤害（气功）", () => {
    const setup = makeCombat("passive-qigong-danmaku", passive({ danmakuDamageBonus: 3 }), passive());
    startRound(setup.state, setup.actor, setup.e1);
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "DANMAKU",
      danmakuDpReduction: 2,
      danmakuBaseDamage: 5
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    expect(setup.e1.hp).toBe(setup.e1.maxHp - 8);
  });

  it("追加 DP（护盾术）优先用于回避消耗", () => {
    const setup = makeCombat("shield-temp-dp", passive(), passive());
    startRound(setup.state, setup.actor, setup.e1);
    setup.e1.tempDp = 6;
    ranged(setup.state, "e1", "10");
    resolveDpTurn(touhou, setup.state, { e1: { type: "DODGE", dpDice: 1 } });
    expect(setup.e1.tempDp).toBe(5);
    expect(setup.e1.dp).toBe(30);
  });

  it("DP 射击应用属性弱点（水克火）", () => {
    const setup = makeCombat("dp-element-weakness", passive(), passive());
    setup.e1.elements = ["FIRE"];
    startRound(setup.state, setup.actor, setup.e1);
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 3,
      damage: "1",
      element: "WATER"
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    const damageLog = setup.state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damageLog?.text).toContain("WEAKNESS");
    expect(damageLog?.text).toContain("WATER");
  });

  it("属性赋予的 grantedElement 在攻击元素未指定时生效", () => {
    const setup = makeCombat("dp-element-grant", passive(), passive());
    setup.e1.elements = ["FIRE"];
    setup.actor.grantedElement = "WATER";
    startRound(setup.state, setup.actor, setup.e1);
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 3,
      damage: "1"
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "PASS" } });
    const damageLog = setup.state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damageLog?.text).toContain("WEAKNESS");
  });

  it("集中力：PASS 宣言后降低下次回避 DP 消耗并清除宣言", () => {
    const setup = makeCombat("focus-defense", passive(), passive());
    startRound(setup.state, setup.actor, setup.e1);
    setup.e1.maxDp = 30;
    setup.e1.dp = 30;
    setup.state.pending["e1"] = { actorId: "e1", kind: "PASS", focusDefense: true };
    resolveDpActionForActor(touhou, setup.state, {}, "e1");
    expect(setup.e1.focusDefense).toBe(true);

    // 回避 3D 基础消耗 3 DP；集中力减免 max(3, floor(30/6)×1)=5 → 实际 0。
    setup.state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 1,
      damage: "10"
    };
    resolveDpTurn(touhou, setup.state, { e1: { type: "DODGE", dpDice: 3 } });
    expect(setup.e1.focusDefense).toBe(false);
    expect(setup.e1.dp).toBe(30);
  });

  it("accuracyBonus 能提高攻击达成值（日志中的 achievement 对照）", () => {
    const base = makeCombat("passive-acc-base", passive(), passive());
    startRound(base.state, base.actor, base.e1);
    ranged(base.state, "e1", "10");
    resolveDpTurn(touhou, base.state, { e1: { type: "PASS" } });
    const baseAchievement = Number(
      base.state.log.find((entry) => entry.data?.rollType === "DP_RANGED_ATTACK")?.data?.achievement ?? 0
    );

    const boosted = makeCombat("passive-acc-base", passive({ accuracyBonus: 12 }), passive());
    startRound(boosted.state, boosted.actor, boosted.e1);
    ranged(boosted.state, "e1", "10");
    resolveDpTurn(touhou, boosted.state, { e1: { type: "PASS" } });
    const boostedAchievement = Number(
      boosted.state.log.find((entry) => entry.data?.rollType === "DP_RANGED_ATTACK")?.data?.achievement ?? 0
    );

    expect(boostedAchievement).toBe(baseAchievement + 12);
  });
});
