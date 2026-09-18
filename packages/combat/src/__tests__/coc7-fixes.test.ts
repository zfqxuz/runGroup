import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  makeCondition,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import {
  addParticipant,
  beginInitiativeRound,
  buildInitiativeOrder,
  createCombat,
  resolveImmediateAction,
  resolveInitiativeTurn,
  resolvePending,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const coc = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const baseAttributes: AttributeSet = {
  str: 50,
  con: 50,
  siz: 50,
  dex: 50,
  app: 50,
  int: 50,
  pow: 50,
  edu: 50,
  luck: 50
};

function makeInitiativeCombat(
  seed: string,
  attackerSkills: Record<string, number>,
  defenderSkills: Record<string, number>
): { state: CombatState; attacker: CombatParticipantState; defender: CombatParticipantState } {
  const state = createCombat({ id: "c1", seed, tickMs: 250, mode: "INITIATIVE" });
  const attacker = addParticipant(state, {
    id: "p1",
    name: "攻击者",
    kind: "PLAYER",
    characterId: "char-p1",
    faction: "PC",
    attributes: { ...baseAttributes, dex: 80 },
    derived: computeDerived(coc, { attributes: { ...baseAttributes, dex: 80 } }).derived,
    skills: attackerSkills,
    damageBonus: "0",
    atbMax: computeAtbMax(coc, { dex: 80 }),
    speed: computeBaseSpeed(coc, { dex: 80 })
  });
  const defender = addParticipant(state, {
    id: "p2",
    name: "防御者",
    kind: "PLAYER",
    characterId: "char-p2",
    faction: "ENEMY",
    attributes: { ...baseAttributes, dex: 60 },
    derived: computeDerived(coc, { attributes: { ...baseAttributes, dex: 60 } }).derived,
    skills: defenderSkills,
    damageBonus: "0",
    atbMax: computeAtbMax(coc, { dex: 60 }),
    speed: computeBaseSpeed(coc, { dex: 60 })
  });
  beginInitiativeRound(coc, state);
  return { state, attacker, defender };
}

function submitAttack(
  state: CombatState,
  options: { skill?: string; damage?: string; damageType?: "BLUNT" | "IMPALING" | "NONE"; shots?: number } = {}
): void {
  expect(
    submitAction(state, {
      actorId: "p1",
      kind: "DANMAKU",
      targetId: "p2",
      skill: options.skill ?? "FIGHTING_BRAWL",
      damage: options.damage ?? "1d6",
      damageType: options.damageType,
      shots: options.shots
    })
  ).toBe(true);
}

describe("COC7 入门规则修复", () => {
  it("闪避成功也必须让攻击者成功等级更高；否则命中", () => {
    let verified = false;
    for (let index = 0; index < 800; index += 1) {
      const { state, defender } = makeInitiativeCombat(
        "dodge-rank-" + String(index),
        { FIGHTING_BRAWL: 999 },
        { DODGE: 40 }
      );
      submitAttack(state);
      resolveInitiativeTurn(coc, state, { p2: { type: "DODGE", skill: "DODGE" } });
      const dodgeLog = state.log.find((entry) => entry.data?.rollType === "DODGE");
      const settleLog = state.log.find((entry) => entry.data?.rollType === "DAMAGE_SETTLE");
      const dodgeResult = dodgeLog?.data?.result;
      if (
        settleLog !== undefined &&
        (dodgeResult === "REGULAR" || dodgeResult === "HARD") &&
        dodgeLog?.data?.success === false
      ) {
        expect(defender.hp).toBeLessThan(defender.maxHp);
        verified = true;
        break;
      }
    }
    expect(verified).toBe(true);
  });

  it("反击同级时攻击者获胜（即使防守方技能更高）", () => {
    let verified = false;
    for (let index = 0; index < 1200; index += 1) {
      const { state, defender } = makeInitiativeCombat(
        "counter-tie-" + String(index),
        { FIGHTING_BRAWL: 50 },
        { FIGHTING_BRAWL: 80 }
      );
      submitAttack(state, { damage: "1" });
      resolveInitiativeTurn(coc, state, { p2: { type: "COUNTER", skill: "FIGHTING_BRAWL" } });
      const attackLog = state.log.find((entry) => entry.data?.rollType === "ATTACK");
      const counterLog = state.log.find((entry) => entry.data?.rollType === "COUNTER");
      const attackResult = attackLog?.data?.result;
      const counterResult = counterLog?.data?.counterResult;
      if (
        attackResult !== undefined &&
        attackResult === counterResult &&
        (attackResult === "REGULAR" || attackResult === "HARD") &&
        counterLog?.data?.success === false
      ) {
        expect(defender.hp).toBeLessThan(defender.maxHp);
        verified = true;
        break;
      }
    }
    expect(verified).toBe(true);
  });

  it("反击成功会向攻击者结算反击伤害", () => {
    let verified = false;
    for (let index = 0; index < 2000; index += 1) {
      const { state, attacker } = makeInitiativeCombat(
        "counter-damage-" + String(index),
        { FIGHTING_BRAWL: 999 },
        { FIGHTING_BRAWL: 999 }
      );
      submitAttack(state, { damage: "1" });
      resolveInitiativeTurn(coc, state, {
        p2: { type: "COUNTER", skill: "FIGHTING_BRAWL", damage: "1d4" }
      });
      const counterSettle = state.log.find((entry) => entry.data?.rollType === "COUNTER_DAMAGE_SETTLE");
      if (counterSettle !== undefined) {
        expect(attacker.hp).toBeLessThan(attacker.maxHp);
        verified = true;
        break;
      }
    }
    expect(verified).toBe(true);
  });

  it("极难成功时贯穿武器取最大伤害 + DB + 额外武器骰", () => {
    const { state, attacker } = makeInitiativeCombat(
      "extreme-impale",
      { FIGHTING_BRAWL: 999 },
      {}
    );
    attacker.damageBonus = "1d4";
    submitAttack(state, { damage: "1d4+db", damageType: "IMPALING" });
    resolveInitiativeTurn(coc, state);
    const damageLog = state.log.find((entry) => entry.data?.rollType === "DAMAGE_ROLL");
    expect(damageLog?.data?.mode).toBe("EXTREME_IMPALING");
    const total = Number(damageLog?.data?.roll ?? 0);
    expect(total).toBeGreaterThanOrEqual(4 + 1 + 1);
    expect(total).toBeLessThanOrEqual(4 + 4 + 4);
  });

  it("寻找掩体成功会给攻击者惩罚骰，并让掩体者下次行动跳过", () => {
    const { state, defender } = makeInitiativeCombat(
      "seek-cover",
      { FIREARMS_HANDGUN: 999 },
      { DODGE: 999 }
    );
    submitAttack(state, { skill: "FIREARMS_HANDGUN", damage: "1d6" });
    resolveInitiativeTurn(coc, state, { p2: { type: "SEEK_COVER", skill: "DODGE" } });
    const coverLog = state.log.find((entry) => entry.data?.rollType === "SEEK_COVER");
    const attackLog = state.log.find((entry) => entry.data?.rollType === "ATTACK");
    expect(coverLog?.data?.success).toBe(true);
    expect(attackLog?.text).toContain("惩罚骰");
    expect(defender.skipNextAction).toBe(1);
  });

  it("战技：踢倒成功使目标倒地；体格差 3 点以上直接不可行", () => {
    const { state, defender } = makeInitiativeCombat("maneuver", { FIGHTING_BRAWL: 999 }, {});
    const result = resolveImmediateAction(coc, state, {
      actorId: "p1",
      kind: "MANEUVER",
      maneuver: "TRIP",
      targetId: "p2"
    });
    expect(result.acted).toContain("p1");
    expect(defender.prone).toBe(true);

    defender.prone = false;
    defender.attributes.str = 110;
    defender.attributes.siz = 110;
    const impossible = resolveImmediateAction(coc, state, {
      actorId: "p1",
      kind: "MANEUVER",
      maneuver: "GRAPPLE",
      targetId: "p2"
    });
    expect(impossible.acted).toContain("p1");
    expect(defender.grappledBy).toBeFalsy();
    expect(state.log.some((entry) => entry.data?.impossible === true)).toBe(true);
  });

  it("手枪连射 3 发：每发各带 1 惩罚骰并逐发结算", () => {
    const { state } = makeInitiativeCombat(
      "rapid-fire",
      { FIREARMS_HANDGUN: 999 },
      {}
    );
    submitAttack(state, { skill: "FIREARMS_HANDGUN", damage: "1", shots: 3 });
    resolveInitiativeTurn(coc, state, { p2: { type: "PASS" } });
    const attackLogs = state.log.filter(
      (entry) => entry.data?.rollType === "ATTACK" && entry.actorId === "p1"
    );
    const settleLogs = state.log.filter((entry) => entry.data?.rollType === "DAMAGE_SETTLE");
    expect(attackLogs).toHaveLength(3);
    expect(attackLogs.every((entry) => entry.text.includes("惩罚骰") && entry.text.includes("第"))).toBe(true);
    expect(settleLogs).toHaveLength(3);
  });

  it("准备火器 +50 先攻修正会改变出手顺序", () => {
    const { state, defender } = makeInitiativeCombat("ready-weapon", { FIGHTING_BRAWL: 50 }, {});
    defender.initiativeMod = 50;
    expect(buildInitiativeOrder(coc, state)[0]).toBe("p2");
  });

  it("寡不敌众：目标本轮已经闪避/反击后，后续近战攻击获得奖励骰", () => {
    const { state, defender } = makeInitiativeCombat(
      "outnumbered",
      { FIGHTING_BRAWL: 999 },
      { DODGE: 999 }
    );
    const third = addParticipant(state, {
      id: "p3",
      name: "第二攻击者",
      kind: "PLAYER",
      characterId: "char-p3",
      faction: "PC",
      attributes: { ...baseAttributes, dex: 40 },
      derived: computeDerived(coc, { attributes: { ...baseAttributes, dex: 40 } }).derived,
      skills: { FIGHTING_BRAWL: 999 },
      damageBonus: "0",
      atbMax: computeAtbMax(coc, { dex: 40 }),
      speed: computeBaseSpeed(coc, { dex: 40 })
    });
    resolveImmediateAction(
      coc,
      state,
      { actorId: "p1", kind: "DANMAKU", targetId: "p2", skill: "FIGHTING_BRAWL", damage: "1" },
      { p2: { type: "DODGE", skill: "DODGE" } }
    );
    expect(defender.reactionsThisRound).toBe(1);

    const result = resolveImmediateAction(coc, state, {
      actorId: "p3",
      kind: "DANMAKU",
      targetId: "p2",
      skill: "FIGHTING_BRAWL",
      damage: "1"
    }, { p2: { type: "PASS" } });
    expect(result.acted).toContain("p3");
    const attackLog = state.log.find((entry) => entry.data?.rollType === "ATTACK" && entry.actorId === "p3");
    expect(attackLog?.text).toContain("奖励骰");
    expect(third.id).toBe("p3");
  });

  it("U-1 自定义状态提供攻击修正，并在日志中展示修正来源与骰数", () => {
    const { state, attacker } = makeInitiativeCombat("u1-attack-modifier", { FIGHTING_BRAWL: 50 }, {});
    attacker.conditions = [
      makeCondition({
        type: "CURSE",
        note: "女巫诅咒",
        unit: "ROUND",
        remaining: 1,
        data: { attackBonusDice: 1, attackPenaltyDice: 2 }
      })
    ];
    const result = resolveImmediateAction(coc, state, {
      actorId: "p1",
      kind: "DANMAKU",
      targetId: "p2",
      skill: "FIGHTING_BRAWL",
      damage: "1"
    }, { p2: { type: "PASS" } });
    expect(result.acted).toContain("p1");
    const attackLog = state.log.find(
      (entry) => entry.data?.rollType === "ATTACK" && entry.actorId === "p1"
    );
    expect(attackLog?.text).toContain("女巫诅咒");
    expect(String(attackLog?.data?.modifiers ?? "")).toContain("1 奖励骰");
    expect(String(attackLog?.data?.modifiers ?? "")).toContain("2 惩罚骰");
  });

  it("U-1 自定义状态提供防御修正，并在闪避日志中展示来源", () => {
    const { state, defender } = makeInitiativeCombat(
      "u1-defense-modifier",
      { FIGHTING_BRAWL: 50 },
      { DODGE: 40 }
    );
    defender.conditions = [
      makeCondition({
        type: "STATUS:守护",
        note: "守护祝福",
        unit: "ROUND",
        remaining: 1,
        data: { defenseBonusDice: 1 }
      })
    ];
    resolveImmediateAction(coc, state, {
      actorId: "p1",
      kind: "DANMAKU",
      targetId: "p2",
      skill: "FIGHTING_BRAWL",
      damage: "1"
    }, { p2: { type: "DODGE", skill: "DODGE" } });
    const dodgeLog = state.log.find((entry) => entry.data?.rollType === "DODGE");
    expect(dodgeLog?.text).toContain("守护祝福");
    expect(String(dodgeLog?.data?.modifiers ?? "")).toContain("1 奖励骰");
  });

  it("U-1 疯狂发作的防御惩罚骰对反击同样生效", () => {
    const { state, defender } = makeInitiativeCombat(
      "u1-counter-insanity",
      { FIGHTING_BRAWL: 999 },
      { FIGHTING_BRAWL: 999 }
    );
    defender.conditions = [
      makeCondition({
        type: "INSANITY",
        note: "疯狂发作",
        unit: "ROUND",
        remaining: 1,
        data: { penaltyDice: 1 }
      })
    ];
    resolveImmediateAction(coc, state, {
      actorId: "p1",
      kind: "DANMAKU",
      targetId: "p2",
      skill: "FIGHTING_BRAWL",
      damage: "1"
    }, { p2: { type: "COUNTER", skill: "FIGHTING_BRAWL" } });
    const counterLog = state.log.find((entry) => entry.data?.rollType === "COUNTER");
    expect(counterLog?.text).toContain("疯狂发作");
    expect(String(counterLog?.data?.modifiers ?? "")).toContain("1 惩罚骰");
  });

  it("COC7 MP 不足时按缺口从 HP 扣除", () => {
    const magicPack = compileParsedRulePack({
      ...resolveRulePack("coc7-baseline", builtinRegistry()),
      id: "coc7-mp-overflow-test",
      magic: {
        enabled: true,
        system: "COC7",
        spells: [
          {
            id: "drain-self",
            name: "抽取生命",
            skill: "MAGIC",
            mpCost: "5",
            sanCost: "0",
            target: "SELF",
            effects: [{ type: "HEAL", amount: "1" }]
          }
        ]
      }
    });
    const state = createCombat({ id: "mp-overflow", seed: "mp-overflow", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: baseAttributes }).derived;
    const caster = addParticipant(state, {
      id: "caster",
      name: "施法者",
      kind: "PLAYER",
      characterId: "caster",
      faction: "PC",
      attributes: baseAttributes,
      derived,
      skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 50 }),
      speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.mp = 0;
    caster.hp = 10;
    caster.isReady = true;
    expect(
      submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "drain-self" })
    ).toBe(true);
    resolvePending(magicPack, state, {});
    // MP 缺口 5 → HP 10→5，自愈 +1 → 6
    expect(caster.hp).toBe(6);
    expect(state.log.some((entry) => entry.data?.rollType === "MP_OVERFLOW_TO_HP")).toBe(true);
  });
});
