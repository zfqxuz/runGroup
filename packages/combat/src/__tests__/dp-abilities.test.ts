import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet,
  type PackRegistry
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

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function buildDpAbilityPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "touhou-dp-ability-test": {
      schemaVersion: 1,
      id: "touhou-dp-ability-test",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      combat: { mode: "DP" },
      magic: {
        enabled: true,
        spells: [
          {
            id: "DP_BOLT",
            name: "灵符·DP测试",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "1" }
          },
          {
            id: "DP_BOLT_RESIST",
            name: "灵符·DP可抵抗",
            abilityId: "SPIRIT_ARTS",
            requiredLevel: 1,
            mpCost: "5",
            sanCost: "0",
            target: "ONE",
            targeting: "ENEMY",
            effects: [{ type: "DAMAGE", amount: "4" }],
            activation: { dice: "3D6", modifier: "0", target: "1" },
            resist: { attribute: "str", skill: "RESIST", dice: "3D6" }
          }
        ]
      }
    }
  };
  return compileParsedRulePack(resolveRulePack("touhou-dp-ability-test", custom));
}

const pack = buildDpAbilityPack();

interface Setup {
  readonly state: CombatState;
  readonly actor: CombatParticipantState;
  readonly e1: CombatParticipantState;
}

function makeSetup(
  seed: string,
  actorOptions: Partial<Parameters<typeof addParticipant>[1]> = {},
  enemyOptions: Partial<Parameters<typeof addParticipant>[1]> = {}
): Setup {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250, mode: "DP" });
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  const build = (id: string, faction: string, kind: "PLAYER" | "NPC", options: Partial<Parameters<typeof addParticipant>[1]>) =>
    addParticipant(state, {
      id,
      name: id,
      kind,
      characterId: kind === "PLAYER" ? id : null,
      faction,
      attributes: attrs,
      derived,
      skills: { DANMAKU: 100, DODGE: 100, MELEE: 100, RESIST: 0 },
      atbMax: computeAtbMax(pack, { dex: attrs.dex }),
      speed: computeBaseSpeed(pack, { dex: attrs.dex }),
      ...options
    });
  const actor = build("actor", "PC", "PLAYER", actorOptions);
  const e1 = build("e1", "BOSS", "NPC", enemyOptions);
  return { state, actor, e1 };
}

function startRound(setup: Setup, actorDp = 30, enemyDp = 30): void {
  beginDpRound(pack, setup.state);
  setup.actor.dp = actorDp;
  setup.e1.dp = enemyDp;
  declareDp(setup.state, "actor", actorDp);
  declareDp(setup.state, "e1", 0);
}

describe("DP 能力发动", () => {
  it("消费 DP 骰（最多 3D）、发动成功并结算效果", () => {
    const setup = makeSetup("dp-ability-basic", { abilityLevels: { SPIRIT_ARTS: 3 } });
    const { state, actor, e1 } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT",
      name: "DP_BOLT",
      dpDice: 3
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    expect(actor.dp).toBe(27); // 30 - 3
    expect(actor.mp).toBe(actor.maxMp - 5);
    expect(e1.hp).toBe(e1.maxHp - 4);
    const activation = state.log.find((entry) => entry.data?.rollType === "ABILITY_ACTIVATION");
    expect(activation?.data?.mode).toBe("DP");
    expect(activation?.data?.dpDice).toBe(3);
    expect(activation?.data?.success).toBe(true);
  });

  it("请求骰数超过上限时夹到 maxDicePerCheck", () => {
    const setup = makeSetup("dp-ability-clamp", { abilityLevels: { SPIRIT_ARTS: 3 } });
    const { state, actor } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT",
      name: "DP_BOLT",
      dpDice: 99
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const activation = state.log.find((entry) => entry.data?.rollType === "ABILITY_ACTIVATION");
    expect(activation?.data?.dpDice).toBe(3);
    expect(actor.dp).toBe(27);
  });

  it("DP 不足时发动被拦截，不消耗灵力、不结算效果", () => {
    const setup = makeSetup("dp-ability-poor", { abilityLevels: { SPIRIT_ARTS: 3 } });
    const { state, actor, e1 } = setup;
    startRound(setup, 1);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT",
      name: "DP_BOLT",
      dpDice: 3
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    expect(actor.dp).toBe(1);
    expect(actor.mp).toBe(actor.maxMp);
    expect(e1.hp).toBe(e1.maxHp);
    expect(state.log.some((entry) => entry.data?.rollType === "DP_INSUFFICIENT")).toBe(true);
  });
});

describe("DP 能力抵抗", () => {
  it("目标消费 DP 掷抵抗，成功时效果无效", () => {
    const setup = makeSetup(
      "dp-ability-resist-ok",
      { abilityLevels: { SPIRIT_ARTS: 1 } },
      { skills: { DANMAKU: 100, DODGE: 100, RESIST: 100 }, attributes: { ...attrs, str: 100 } }
    );
    const { state, actor, e1 } = setup;
    startRound(setup, 30, 30);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT_RESIST",
      name: "DP_BOLT_RESIST",
      dpDice: 3
    };
    resolveDpTurn(pack, state, { e1: { type: "RESIST", dpDice: 3 } });
    expect(e1.dp).toBe(27); // 30 - 3
    expect(e1.hp).toBe(e1.maxHp);
    const resist = state.log.find((entry) => entry.data?.rollType === "DP_ABILITY_RESIST");
    expect(resist?.data?.success).toBe(true);
    expect(actor.mp).toBe(actor.maxMp - 5);
  });

  it("DP 不足时抵抗自动失败，效果照常结算", () => {
    const setup = makeSetup("dp-ability-resist-poor", { abilityLevels: { SPIRIT_ARTS: 1 } });
    const { state, e1 } = setup;
    startRound(setup, 30, 0);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT_RESIST",
      name: "DP_BOLT_RESIST",
      dpDice: 3
    };
    resolveDpTurn(pack, state, { e1: { type: "RESIST", dpDice: 3 } });
    expect(e1.dp).toBe(0);
    expect(e1.hp).toBe(e1.maxHp - 4);
    const resist = state.log.find((entry) => entry.data?.rollType === "DP_ABILITY_RESIST");
    expect(resist?.data?.dpInsufficient).toBe(true);
  });
});

describe("DP 千幻抄伤害公式", () => {
  it("射击：damageAbilityId 提供时用 能力 LvD + 特性", () => {
    const setup = makeSetup(
      "dp-dmg-ranged",
      { abilityLevels: { SPIRIT_ARTS: 3 } },
      { skills: { DANMAKU: 0, DODGE: 0, RESIST: 0 } }
    );
    const { state } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 1,
      damageAbilityId: "SPIRIT_ARTS"
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damage?.data?.expression).toBe("3d6+55");
  });

  it("追击：damageAbilityId 提供时用 能力 Lv÷2 D + 特性", () => {
    const setup = makeSetup(
      "dp-dmg-chase",
      { abilityLevels: { SPIRIT_ARTS: 5 } },
      { skills: { DANMAKU: 0, DODGE: 0, RESIST: 0 } }
    );
    const { state } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "CHASE",
      dpTargetIds: ["e1"],
      skill: "DANMAKU",
      damageAbilityId: "SPIRIT_ARTS"
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_DAMAGE");
    expect(damage?.data?.expression).toBe("2d6+55");
  });

  it("近战：damageTrainingId 提供时用 {身体} + 锻炼 LvD + 武器 Lv", () => {
    const setup = makeSetup(
      "dp-dmg-melee",
      { abilityLevels: { FEAT: 4 } },
      { skills: { DANMAKU: 0, DODGE: 0, RESIST: 0 } }
    );
    const { state } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "MELEE",
      targetId: "e1",
      skill: "MELEE",
      dpDice: 10,
      dpSecondaryDice: 10,
      damageTrainingId: "FEAT"
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_DAMAGE");
    // 近战 body = str 50，锻炼 Lv4，武器技能 MELEE 100/20 = 5
    expect(damage?.data?.expression).toBe("4d6+55");
  });

  it("未提供公式字段时回退到卡面 damage", () => {
    const setup = makeSetup("dp-dmg-card");
    const { state } = setup;
    startRound(setup);
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 1,
      damage: "7"
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damage?.data?.expression).toBe("7");
  });
});

describe("DP 能力每回合一次 / 符卡强化", () => {
  it("同一回合第二次发动能力被拦截，不消耗 DP / 灵力", () => {
    const setup = makeSetup("dp-ability-once", { abilityLevels: { SPIRIT_ARTS: 3 } });
    const { state, actor, e1 } = setup;
    startRound(setup);
    actor.abilityUsedThisRound = true;
    state.pending["actor"] = {
      actorId: "actor",
      kind: "MAGIC",
      targetId: "e1",
      spellId: "DP_BOLT",
      name: "DP_BOLT",
      dpDice: 3
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    expect(actor.dp).toBe(30);
    expect(actor.mp).toBe(actor.maxMp);
    expect(e1.hp).toBe(e1.maxHp);
    expect(state.log.some((entry) => entry.data?.rollType === "ABILITY_ALREADY_USED")).toBe(true);
  });

  it("回合开始重置 abilityUsedThisRound", () => {
    const setup = makeSetup("dp-ability-reset", { abilityLevels: { SPIRIT_ARTS: 3 } });
    const { actor } = setup;
    actor.abilityUsedThisRound = true;
    beginDpRound(pack, setup.state);
    expect(actor.abilityUsedThisRound).toBe(false);
  });

  it("展开型符卡强化弹幕射击伤害 flat +3", () => {
    const setup = makeSetup(
      "dp-enhance-ranged",
      {},
      { skills: { DANMAKU: 0, DODGE: 0, RESIST: 0 } }
    );
    const { state, actor } = setup;
    startRound(setup);
    actor.declaration = {
      name: "测试符卡",
      hp: 10,
      maxHp: 10,
      expiresAtTick: 9999,
      clearTargets: "ALL",
      cardId: null,
      damageMultiplier: 1,
      enhanceType: "DANMAKU",
      enhanceValue: 1
    };
    state.pending["actor"] = {
      actorId: "actor",
      kind: "DANMAKU",
      dpAction: "RANGED",
      targetId: "e1",
      skill: "DANMAKU",
      dpDice: 1,
      damage: "1"
    };
    resolveDpTurn(pack, state, { e1: { type: "PASS" } });
    const damage = state.log.find((entry) => entry.data?.rollType === "DP_RANGED_DAMAGE");
    expect(damage?.data?.enhanceFlat).toBe(3);
    // 1 + 3 = 4 点伤害
    expect(damage?.data?.damage).toBe(4);
  });
});
