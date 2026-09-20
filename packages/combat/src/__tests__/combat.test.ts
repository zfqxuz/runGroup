import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveActionCost,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import {
  addParticipant,
  advanceToNextEvent,
  applyForcedSkips,
  applyStatus,
  createCombat,
  expireBarriers,
  filterCombatForViewer,
  reactionTargetIdsForAction,
  recoverTouhouLscLimits,
  resolvePending,
  resolveSpellcardImmediate,
  spellcardBattleSummary,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));
const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

interface Setup {
  readonly state: CombatState;
  readonly a: CombatParticipantState;
  readonly b: CombatParticipantState;
  readonly npc: CombatParticipantState;
}

function makeCombat(seed = "test-seed"): Setup {
  const state = createCombat({ id: "c1", seed, tickMs: 250 });
  const derived = computeDerived(touhou, { attributes: attrs }).derived;

  const a = addParticipant(state, {
    id: "a", name: "灵梦", kind: "PLAYER", characterId: "char-a", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100, DODGE: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }), speed: computeBaseSpeed(touhou, { dex: 55 })
  });
  const b = addParticipant(state, {
    id: "b", name: "魔理沙", kind: "PLAYER", characterId: "char-b", faction: "PC",
    attributes: attrs, derived, skills: { DANMAKU: 100, DODGE: 100 },
    atbMax: computeAtbMax(touhou, { dex: 55 }), speed: computeBaseSpeed(touhou, { dex: 55 })
  });
  const npc = addParticipant(state, {
    id: "npc", name: "露米娅", kind: "NPC", characterId: null, faction: "BOSS",
    attributes: attrs, derived, skills: { DANMAKU: 60 },
    atbMax: computeAtbMax(touhou, { dex: 10 }), speed: computeBaseSpeed(touhou, { dex: 10 })
  });

  return { state, a, b, npc };
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

describe("全局计数器推进", () => {
  it("推进到第一个就绪事件", () => {
    const { state, a, npc } = makeCombat();
    const result = advanceToNextEvent(touhou, state);
    expect(result.ticks).toBe(14);
    expect(result.ms).toBe(3500);
    expect([...result.readyIds].sort()).toEqual(["a", "b"]);
    expect(a.isReady).toBe(true);
    expect(npc.isReady).toBe(false);
    expect(state.phase).toBe("AWAITING_ACTION");
  });

  it("HASTE 状态改变速度并影响就绪帧数", () => {
    const { state, a } = makeCombat();
    expect(a.speed).toBe(7500);
    applyStatus(touhou, state, "a", "HASTE", 1);
    expect(a.speed).toBe(11250);
    const result = advanceToNextEvent(touhou, state);
    expect(result.ticks).toBe(9);
  });
});

describe("弹幕攻防结算", () => {
  it("命中后按管线扣血", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    const result = resolvePending(touhou, state, { b: { type: "PASS" } });
    expect(result.acted).toEqual(["a"]);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(b.hp).toBeGreaterThanOrEqual(b.maxHp - 12);
  });

  it("防御对抗成功时免伤且不消耗灵力", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    b.skills.MELEE = 999;
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    const mpBefore = b.mp;
    resolvePending(touhou, state, { b: { type: "DEFEND" } });
    expect(b.hp).toBe(b.maxHp);
    expect(b.mp).toBe(mpBefore);
  });

  it("防御对抗失败时按 failReduce 固定减伤", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    b.skills.MELEE = 0;
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "40"
    });
    resolvePending(touhou, state, { b: { type: "DEFEND" } });
    expect(b.hp).toBe(Math.max(0, b.maxHp - 10));
    expect(state.log.some((entry) => entry.text.includes("防御失败"))).toBe(true);
  });

  it("擦弹成功免伤并积攒擦弹点数", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    b.mp = 10;
    resolvePending(touhou, state, { b: { type: "DODGE", skill: "DODGE" } });
    expect(b.hp).toBe(b.maxHp);
    expect(b.mp).toBe(10);
    expect(b.grazePoints).toBeGreaterThan(0);
  });

  it("可用擦弹点数兑换灵力", () => {
    const { state, a } = makeCombat();
    a.grazePoints = 5;
    a.mp = 10;
    forceReady(a);
    submitAction(state, { actorId: "a", kind: "PASS", grazeSpend: "MP" });
    resolvePending(touhou, state);
    expect(a.grazePoints).toBe(0);
    expect(a.mp).toBe(11);
    expect(state.log.some((entry) => entry.text.includes("回复灵力"))).toBe(true);
  });

  it("可用擦弹点数强化下一次近战伤害", () => {
    const { state, a, b } = makeCombat();
    a.grazePoints = 3;
    a.skills.MELEE = 100;
    forceReady(a);
    submitAction(state, { actorId: "a", kind: "PASS", grazeSpend: "MELEE_DAMAGE" });
    resolvePending(touhou, state);
    expect(a.grazePoints).toBe(0);
    expect(a.grazeDamageBonus).toBe(3);

    forceReady(a);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "MELEE", damage: "6"
    });
    resolvePending(touhou, state, { b: { type: "PASS" } });
    expect(b.hp).toBe(b.maxHp - 9);
  });

  it("未提交行动的人不会行动", () => {
    const { state } = makeCombat();
    advanceToNextEvent(touhou, state);
    const result = resolvePending(touhou, state);
    expect(result.acted).toEqual([]);
  });
});

describe("符卡", () => {
  it("展开型先吃伤害，击破时清除队列中的弹幕", () => {
    const { state, a, b, npc } = makeCombat();
    forceReady(a);
    forceReady(b);
    forceReady(npc);

    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    submitAction(state, {
      actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "1d6+10"
    });
    submitAction(state, {
      actorId: "npc", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "2d6"
    });

    const result = resolvePending(touhou, state, { a: { type: "PASS" } });

    expect(result.cleared).toContain("npc");
    expect(a.declaration).toBeNull();
    // 千幻抄：SC 被击破时溢出伤害无效，不会打到本体。
    expect(a.hp).toBe(a.maxHp);
    expect(state.log.some((entry) => entry.text.includes("被击破"))).toBe(true);
    expect(state.log.some((entry) => entry.text.includes("溢出"))).toBe(true);
  });

  it("击破展开型 SC 的一方按自然回复量回复 DP（4.11）", () => {
    const { state, a, b } = makeCombat("sc-break-dp");
    forceReady(a);
    forceReady(b);
    b.dp = 0;
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    submitAction(state, {
      actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "1d6+10"
    });
    resolvePending(touhou, state, { a: { type: "PASS" } });
    expect(a.declaration).toBeNull();
    expect(b.dp).toBeGreaterThan(0);
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_BREAK_DP_RECOVER")).toBe(true);
  });

  it("展开型保存卡牌 id 与自定义清弹范围", () => {
    const { state, a } = makeCombat();
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellCardId: "card-dream",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      declarationClearTargets: "OTHERS_ONLY",
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.declaration?.cardId).toBe("card-dream");
    expect(a.declaration?.clearTargets).toBe("OTHERS_ONLY");
    // 不能是 Infinity；CombatState 会写入 JSON 快照。
    expect(Number.isFinite(a.declaration?.expiresAtTick ?? Number.NaN)).toBe(true);
  });

  it("消费型记录 CONSUME 事件与卡牌 id", () => {
    const { state, a } = makeCombat();
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "指向性激光",
      spellCardId: "card-laser",
      spellcardMode: "CONSUMPTION",
      mpCost: 0
    });
    resolvePending(touhou, state);
    const consume = state.log.find((entry) => entry.data?.event === "CONSUME");
    expect(consume?.data?.cardId).toBe("card-laser");
  });

  it("灵力不足时无法展开", () => {
    const { state, a } = makeCombat();
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      mpCost: 999999
    });
    resolvePending(touhou, state);
    expect(a.declaration).toBeNull();
    expect(state.log.some((entry) => entry.text.includes("灵力不足"))).toBe(true);
  });

  it("同一张符卡每场只能使用一次", () => {
    const { state, a } = makeCombat();
    a.mp = 100;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellCardId: "card-once",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.usedSpellCards).toContain("card-once");
    expect(a.declaration).not.toBeNull();

    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellCardId: "card-once",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.usedSpellCards.filter((item) => item === "card-once")).toHaveLength(1);
    expect(state.log.some((entry) => entry.text.includes("本场已使用过"))).toBe(true);
  });

  it("展开型符卡强化近战伤害", () => {
    const { state, a, b } = makeCombat();
    a.mp = 100;
    a.skills.MELEE = 100;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想封印",
      spellCardId: "card-melee",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      spellcardEnhanceType: "MELEE",
      spellcardEnhanceValue: 2,
      mpCost: 0
    });
    resolvePending(touhou, state);

    forceReady(a);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "MELEE", damage: "6"
    });
    resolvePending(touhou, state, { b: { type: "PASS" } });
    // 规则包 MELEE.damageMultiplier = 1.5；固定伤害 6 -> 9。
    expect(b.hp).toBe(b.maxHp - 9);
  });

  it("消费型符卡会结算卡面效果", () => {
    const { state, a, npc } = makeCombat();
    a.mp = 100;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "指向性激光",
      spellCardId: "card-effect",
      spellcardMode: "CONSUMPTION",
      targetId: "npc",
      targetScope: "ONE",
      targeting: "ENEMY",
      effects: [{ type: "DAMAGE", amount: "5" }],
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(npc.hp).toBe(npc.maxHp - 5);
  });
});

describe("可重放", () => {
  function scripted(seed: string): string {
    const { state, a, b } = makeCombat(seed);
    for (let round = 0; round < 4; round += 1) {
      advanceToNextEvent(touhou, state);
      if (state.phase === "ENDED") break;
      if (a.isReady) {
        submitAction(state, {
          actorId: "a", kind: "DANMAKU", targetId: "npc", skill: "DANMAKU", damage: "2d6"
        });
      }
      if (b.isReady) {
        submitAction(state, {
          actorId: "b", kind: "DANMAKU", targetId: "npc", skill: "DANMAKU", damage: "2d6"
        });
      }
      resolvePending(touhou, state, { npc: { type: "PASS" } });
    }
    return JSON.stringify(state.log);
  }

  it("同种子同动作序列产生逐字相同的日志", () => {
    expect(scripted("replay-seed")).toBe(scripted("replay-seed"));
  });

  it("不同种子产生不同结果", () => {
    expect(scripted("seed-alpha")).not.toBe(scripted("seed-beta"));
  });
});

describe("权限过滤：服务端构造视图", () => {
  it("KP 看到全部数据", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "kp", role: "KP", characterId: null
    });
    const npc = view.participants.find((p) => p.kind === "NPC");
    expect(npc?.name).toBe("露米娅");
    expect(npc?.faction).toBe("BOSS");
    expect(npc?.hp).toBeGreaterThan(0);
  });

  it("PL 看不到未识别 NPC 的名字与任何生命信息", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "u1", role: "PLAYER", characterId: "char-a"
    });
    const npc = view.participants.find((p) => p.kind === "NPC");
    expect(npc?.name).toBe("???");
    expect(npc?.faction).toBeNull();
    expect(npc?.hp).toBeNull();
    expect(npc?.maxHp).toBeNull();
    expect(npc?.hpText).toBeNull();
    expect(npc?.statusEffects).toEqual([]);
  });

  it("PL 对自己的角色可见全量，对队友隐藏数值", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "u1", role: "PLAYER", characterId: "char-a"
    });
    const self = view.participants.find((p) => p.isSelf);
    expect(self?.name).toBe("灵梦");
    expect(self?.hp).toBeGreaterThan(0);

    const ally = view.participants.find((p) => p.id === "b");
    expect(ally?.name).toBe("魔理沙");
    expect(ally?.hp).toBeNull();
    expect(ally?.san).toBeNull();
  });

  it("旁观者同样拿不到数值", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "sp", role: "SPECTATOR", characterId: null
    });
    for (const participant of view.participants) {
      expect(participant.hp).toBeNull();
      expect(participant.san).toBeNull();
    }
  });

  it("KP 公开 NPC 后，玩家可以看到名字与精确数值", () => {
    const { state, npc } = makeCombat();
    npc.isPublic = true;
    const view = filterCombatForViewer(state, {
      userId: "u1", role: "PLAYER", characterId: "char-a"
    });
    const shown = view.participants.find((p) => p.id === "npc");
    expect(shown?.name).toBe("露米娅");
    expect(shown?.hp).toBeGreaterThan(0);
    expect(shown?.maxHp).toBeGreaterThan(0);
    expect(shown?.hpText).not.toBeNull();
  });

  it("房间开启玩家互见时，玩家可以看到队友精确数值", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "u1", role: "PLAYER", characterId: "char-a", canSeePartyStats: true
    });
    const ally = view.participants.find((p) => p.id === "b");
    expect(ally?.hp).toBeGreaterThan(0);
    expect(ally?.san).toBeGreaterThan(0);
    const hiddenNpc = view.participants.find((p) => p.id === "npc");
    expect(hiddenNpc?.hp).toBeNull();
  });
});

describe("魔法施放", () => {
  const magicPack = compileParsedRulePack({
    ...resolveRulePack("touhou-ext", builtinRegistry()),
    magic: {
      enabled: true,
      system: "TOUHOU",
      spells: [
        {
          id: "fireball",
          name: "火球",
          skill: "MAGIC",
          mpCost: "3",
          sanCost: "0",
          damage: "1d6",
          target: "ONE",
          effects: []
        },
        {
          id: "selfheal",
          name: "自愈",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "SELF",
          effects: [{ type: "HEAL", amount: "5" }]
        },
        {
          id: "doom",
          name: "蚀血",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "ONE",
          effects: [{ type: "DOT", amount: "3", durationTicks: "2" }]
        },
        {
          id: "paralyze",
          name: "麻痹",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "ONE",
          effects: [{ type: "STUN", durationActions: "1" }]
        },
        {
          id: "selfarmor",
          name: "护盾",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "SELF",
          effects: [{ type: "ARMOR", amount: "5", durationTicks: "0" }]
        },
        {
          id: "selfdamage",
          name: "自伤测试",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "SELF",
          effects: [{ type: "DAMAGE", amount: "1" }]
        },
        {
          id: "summon",
          name: "召唤测试",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "SELF",
          effects: [{ type: "SUMMON", name: "测试召唤物", count: "1", perLevel: 2, durationTicks: "0" }]
        }
      ]
    }
  });

  it("启用法术规则后，MAGIC 行动会消耗 MP 并造成伤害", () => {
    const state = createCombat({ id: "magic-test", seed: "magic-seed", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    const target = addParticipant(state, {
      id: "target", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.isReady = true;
    const mpBefore = caster.mp;
    expect(submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "fireball" })).toBe(true);
    const result = resolvePending(magicPack, state, {});
    expect(result.acted).toContain("caster");
    expect(caster.mp).toBe(mpBefore - 3);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(state.log.some((entry) => entry.text.includes("火球"))).toBe(true);
  });

  it("SELF 目标法术会自动作用到自己", () => {
    const state = createCombat({ id: "magic-self", seed: "magic-self", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    const other = addParticipant(state, {
      id: "other", name: "队友", kind: "PLAYER", characterId: "char-q", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 60 },
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.hp = 3;
    other.hp = 3;
    caster.isReady = true;
    expect(submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "selfheal" })).toBe(true);
    resolvePending(magicPack, state, {});
    expect(caster.hp).toBe(8);
    expect(other.hp).toBe(3);
  });

  it("DOT 会在目标下一回合开始时结算伤害", () => {
    const state = createCombat({ id: "magic-dot", seed: "magic-dot", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    const target = addParticipant(state, {
      id: "target", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "doom" });
    resolvePending(magicPack, state, {});
    const hpAfterCast = target.hp;
    expect(target.statusEffects.some((effect) => effect.key.startsWith("DOT:"))).toBe(true);

    advanceToNextEvent(magicPack, state);
    target.isReady = true;
    submitAction(state, { actorId: "target", kind: "PASS" });
    resolvePending(magicPack, state, {});
    expect(target.hp).toBe(hpAfterCast - 3);
  });

  it("STUN 会让目标下一次行动被强制跳过", () => {
    const state = createCombat({ id: "magic-stun", seed: "magic-stun", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    const target = addParticipant(state, {
      id: "target", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "paralyze" });
    resolvePending(magicPack, state, {});
    expect(target.stunActions).toBe(1);

    target.isReady = true;
    applyForcedSkips(state);
    expect(target.stunActions).toBe(0);
    expect(state.pending.target?.kind).toBe("PASS");
  });

  it("ARMOR 先吸收伤害并扣减护甲，护甲耗尽后才扣 HP", () => {
    const state = createCombat({ id: "magic-armor", seed: "magic-armor", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    addParticipant(state, {
      id: "enemy", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "selfarmor" });
    resolvePending(magicPack, state, {});
    expect(caster.armor).toBe(5);
    expect(caster.maxArmor).toBe(5);

    const hpBefore = caster.hp;
    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "selfdamage" });
    resolvePending(magicPack, state, {});
    expect(caster.hp).toBe(hpBefore);
    expect(caster.armor).toBe(4);

    caster.armor = 0;
    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "selfdamage" });
    resolvePending(magicPack, state, {});
    expect(caster.hp).toBe(hpBefore - 1);
  });

  it("SUMMON 可以把独立模板加入战斗，没有模板时使用通用兜底单位", () => {
    const state = createCombat({ id: "magic-summon", seed: "magic-summon", tickMs: 250 });
    const derived = computeDerived(magicPack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(magicPack, { dex: 55 }), speed: computeBaseSpeed(magicPack, { dex: 55 })
    });
    addParticipant(state, {
      id: "enemy", name: "妖精", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(magicPack, { dex: 50 }), speed: computeBaseSpeed(magicPack, { dex: 50 })
    });
    caster.isReady = true;
    const summonDerived = { ...derived, maxHp: 33, hp: 33 };
    submitAction(state, {
      actorId: "caster",
      kind: "MAGIC",
      spellId: "summon",
      summonTemplate: {
        name: "次元蹑蹒者",
        attributes: attrs,
        derived: summonDerived,
        skills: { FIGHTING_BRAWL: 50 },
        damageBonus: "0"
      }
    });
    resolvePending(magicPack, state, {});
    const summoned = state.participants.find((participant) => participant.summonedBy === "caster");
    expect(summoned).toBeDefined();
    expect(summoned?.name).toBe("次元蹑蹒者");
    expect(summoned?.maxHp).toBe(33);
    expect(summoned?.faction).toBe("PC");

    caster.isReady = true;
    submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "summon" });
    resolvePending(magicPack, state, {});
    const fallback = state.participants.filter((participant) => participant.summonedBy === "caster")[1];
    expect(fallback).toBeDefined();
    expect(fallback?.name).toBe("测试召唤物");
    expect(fallback?.maxHp).toBeGreaterThan(0);
  });
});

describe("ATB 防御性推进", () => {
  it("行动消耗为 0 时不会把 ATB 卡死在 CHARGING", () => {
    const { state, a } = makeCombat();
    // 模拟旧行为：行动消耗 0，ATB 溢出但 isReady 被清掉。
    state.phase = "ATB_CHARGING";
    a.isReady = false;
    a.atbValue = a.atbMax + 9000;
    const result = advanceToNextEvent(touhou, state);
    expect(result.ticks).toBeGreaterThan(0);
    expect(a.isReady).toBe(true);
    expect(state.phase).toBe("AWAITING_ACTION");
  });

  it("COC7 的攻击 / 施法行动有 ATB 消耗", () => {
    expect(resolveActionCost(coc7, "DANMAKU", { dex: 50 })).toBeGreaterThan(0);
    expect(resolveActionCost(coc7, "SPELLCARD", { dex: 50 })).toBeGreaterThan(0);
    expect(resolveActionCost(coc7, "PASS", { dex: 50 })).toBeGreaterThan(0);
  });
});

describe("AOE 应对窗口", () => {
  const aoePack = compileParsedRulePack({
    ...resolveRulePack("touhou-ext", builtinRegistry()),
    magic: {
      enabled: true,
      system: "TOUHOU",
      spells: [
        {
          id: "meteor",
          name: "陨石",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: "ALL",
          effects: [{ type: "DAMAGE", amount: "1d6" }]
        }
      ]
    }
  });

  it("群体敌对法术会给所有命中目标生成应对", () => {
    const state = createCombat({ id: "aoe-targets", seed: "aoe-seed", tickMs: 250 });
    const derived = computeDerived(aoePack, { attributes: attrs }).derived;
    addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(aoePack, { dex: 55 }), speed: computeBaseSpeed(aoePack, { dex: 55 })
    });
    addParticipant(state, {
      id: "e1", name: "妖精A", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(aoePack, { dex: 50 }), speed: computeBaseSpeed(aoePack, { dex: 50 })
    });
    addParticipant(state, {
      id: "e2", name: "妖精B", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(aoePack, { dex: 50 }), speed: computeBaseSpeed(aoePack, { dex: 50 })
    });
    const targets = reactionTargetIdsForAction(aoePack, state, {
      actorId: "caster",
      kind: "MAGIC",
      spellId: "meteor"
    });
    expect(targets.slice().sort()).toEqual(["e1", "e2"]);
  });

  it("AOE 结算时每个目标的应对都会参与", () => {
    const state = createCombat({ id: "aoe-resolve", seed: "aoe-resolve-seed", tickMs: 250 });
    const derived = computeDerived(aoePack, { attributes: attrs }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "帕秋莉", kind: "PLAYER", characterId: "char-p", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(aoePack, { dex: 55 }), speed: computeBaseSpeed(aoePack, { dex: 55 })
    });
    addParticipant(state, {
      id: "e1", name: "妖精A", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: { DODGE: 1 },
      atbMax: computeAtbMax(aoePack, { dex: 50 }), speed: computeBaseSpeed(aoePack, { dex: 50 })
    });
    const e2 = addParticipant(state, {
      id: "e2", name: "妖精B", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(aoePack, { dex: 50 }), speed: computeBaseSpeed(aoePack, { dex: 50 })
    });
    caster.isReady = true;
    expect(submitAction(state, { actorId: "caster", kind: "MAGIC", spellId: "meteor" })).toBe(true);
    const hp2 = e2.hp;
    resolvePending(aoePack, state, {
      e1: { type: "DODGE", skill: "DODGE" },
      e2: { type: "PASS" }
    });
    expect(e2.hp).toBeLessThan(hp2);
  });
});


describe("魔法效果接口矩阵", () => {
  interface EffectRunResult {
    readonly pack: ReturnType<typeof compileParsedRulePack>;
    readonly state: CombatState;
    readonly caster: CombatParticipantState;
    readonly target: CombatParticipantState;
  }

  function makeEffectPack(effect: Record<string, unknown>, self: boolean): ReturnType<typeof compileParsedRulePack> {
    const base = resolveRulePack("touhou-ext", builtinRegistry());
    return compileParsedRulePack({
      ...base,
      magic: {
        enabled: true,
        system: "TOUHOU",
        spells: [{
          id: "test",
          name: "测试法术",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: self ? "SELF" : "ONE",
          targeting: self ? "SELF" : "ENEMY",
          effects: [effect]
        }]
      }
    } as never);
  }

  function runEffect(
    effect: Record<string, unknown>,
    options: {
      readonly self?: boolean;
      readonly setup?: (state: CombatState, caster: CombatParticipantState, target: CombatParticipantState) => void;
    } = {}
  ): EffectRunResult {
    const pack = makeEffectPack(effect, options.self === true);
    const state = createCombat({ id: "effect-matrix", seed: "effect-matrix-" + String(effect.type), tickMs: 250 });
    const derived = computeDerived(pack, { attributes: attrs, skills: {} }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "施法者", kind: "PLAYER", characterId: "char-c", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(pack, { dex: 55 }), speed: computeBaseSpeed(pack, { dex: 55 })
    });
    const target = addParticipant(state, {
      id: "target", name: "目标", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(pack, { dex: 50 }), speed: computeBaseSpeed(pack, { dex: 50 })
    });
    options.setup?.(state, caster, target);
    caster.isReady = true;
    const submitted = submitAction(state, {
      actorId: caster.id,
      kind: "MAGIC",
      spellId: "test",
      targetId: options.self === true ? undefined : target.id
    });
    expect(submitted).toBe(true);
    resolvePending(pack, state, { target: { type: "PASS" } });
    return { pack, state, caster, target };
  }

  it("14 种可枚举效果都能在战斗中执行并改变状态", () => {
    {
      const { target } = runEffect({ type: "DAMAGE", amount: "3" }, {
        setup: (_state, _caster, victim) => { victim.hp = 20; }
      });
      expect(target.hp).toBe(17);
    }
    {
      const { caster } = runEffect({ type: "HEAL", amount: "4" }, {
        self: true,
        setup: (_state, actor) => { actor.hp = 5; }
      });
      expect(caster.hp).toBe(9);
    }
    {
      const { caster } = runEffect({ type: "MP_RESTORE", amount: "3" }, {
        self: true,
        setup: (_state, actor) => { actor.mp = 1; }
      });
      expect(caster.mp).toBe(4);
    }
    {
      const { caster, target } = runEffect({ type: "MP_DRAIN", amount: "3" }, {
        setup: (_state, actor, victim) => { actor.mp = 0; victim.mp = 10; }
      });
      expect(target.mp).toBe(7);
      expect(caster.mp).toBe(3);
    }
    {
      const { target } = runEffect({ type: "SAN_LOSS", amount: "2" }, {
        setup: (_state, _caster, victim) => { victim.san = 30; }
      });
      expect(target.san).toBe(28);
    }
    {
      const { caster } = runEffect({ type: "SAN_RESTORE", amount: "3" }, {
        self: true,
        setup: (_state, actor) => { actor.san = 20; }
      });
      expect(caster.san).toBe(23);
    }
    {
      const { caster } = runEffect({ type: "STATUS", key: "HASTE", stacks: "1" }, { self: true });
      expect(caster.statusEffects.some((effect) => effect.key === "HASTE")).toBe(true);
    }
    {
      const { caster } = runEffect({ type: "ARMOR", amount: "5", durationTicks: "0" }, { self: true });
      expect(caster.armor).toBe(5);
    }
    {
      const { state, caster } = runEffect({ type: "SUMMON", name: "测试召唤物", count: "1", durationTicks: "0" }, { self: true });
      expect(state.participants.some((participant) => participant.summonedBy === caster.id)).toBe(true);
    }
    {
      const { target, state } = runEffect({ type: "POSSESS", durationTurns: "2" });
      expect(target.possessedBy).toBe("caster");
      // resolvePending 已推进到第 2 轮：消耗 1 格后仍剩 1 格
      expect(state.round).toBe(2);
      expect(target.possessCharges).toBe(1);
    }
    {
      const { target } = runEffect({ type: "DOT", amount: "2", durationTicks: "2" });
      expect(target.statusEffects.some((effect) => effect.key.startsWith("DOT:"))).toBe(true);
    }
    {
      const { target } = runEffect({ type: "STUN", durationActions: "1" });
      expect(target.stunActions).toBe(1);
    }
    {
      const { target } = runEffect({ type: "CONTROL", durationActions: "1" });
      expect(target.controlActions).toBe(1);
    }
    {
      const { caster } = runEffect({ type: "CLEANSE", keys: ["STUN", "CONTROL"] }, {
        self: true,
        setup: (_state, actor) => {
          actor.stunActions = 1;
          actor.controlActions = 1;
          actor.statusEffects = [{ key: "DOT:test", stacks: 1, remainingTicks: 10, dotDamage: 1, dotTurns: 1 }];
        }
      });
      expect(caster.stunActions).toBe(0);
      expect(caster.controlActions).toBe(0);
      expect(caster.statusEffects.length).toBe(0);
    }
  });
});

describe("持续型效果按行动轮次到期", () => {
  function castTimedEffect(
    effect: Record<string, unknown>,
    self: boolean
  ): { pack: ReturnType<typeof compileParsedRulePack>; state: CombatState; caster: CombatParticipantState; target: CombatParticipantState } {
    const base = resolveRulePack("touhou-ext", builtinRegistry());
    const pack = compileParsedRulePack({
      ...base,
      magic: {
        enabled: true,
        system: "TOUHOU",
        spells: [{
          id: "timed",
          name: "持续测试",
          skill: "MAGIC",
          mpCost: "0",
          sanCost: "0",
          target: self ? "SELF" : "ONE",
          targeting: self ? "SELF" : "ENEMY",
          effects: [effect]
        }]
      }
    } as never);
    const state = createCombat({ id: "timed", seed: "timed-" + JSON.stringify(effect), tickMs: 250 });
    const derived = computeDerived(pack, { attributes: attrs, skills: {} }).derived;
    const caster = addParticipant(state, {
      id: "caster", name: "施法者", kind: "PLAYER", characterId: "char-c", faction: "PC",
      attributes: attrs, derived, skills: { MAGIC: 80 },
      atbMax: computeAtbMax(pack, { dex: 55 }), speed: computeBaseSpeed(pack, { dex: 55 })
    });
    const target = addParticipant(state, {
      id: "target", name: "敌人", kind: "NPC", characterId: null, faction: "ENEMY",
      attributes: attrs, derived, skills: {},
      atbMax: computeAtbMax(pack, { dex: 50 }), speed: computeBaseSpeed(pack, { dex: 50 })
    });
    caster.isReady = true;
    expect(submitAction(state, {
      actorId: "caster",
      kind: "MAGIC",
      spellId: "timed",
      targetId: self ? undefined : "target"
    })).toBe(true);
    resolvePending(pack, state, { target: { type: "PASS" } });
    return { pack, state, caster, target };
  }

  it("护甲 duration=1 在下一轮开始时失效，duration=2 多保留一轮", () => {
    const one = castTimedEffect({ type: "ARMOR", amount: "5", durationTicks: "1" }, true);
    expect(one.state.round).toBe(2);
    expect(one.caster.armor).toBe(0);

    const two = castTimedEffect({ type: "ARMOR", amount: "5", durationTicks: "2" }, true);
    expect(two.state.round).toBe(2);
    expect(two.caster.armor).toBe(5);
    two.caster.isReady = true;
    resolvePending(two.pack, two.state, {});
    expect(two.state.round).toBe(3);
    expect(two.caster.armor).toBe(0);
  });

  it("夺舍充能池按行动轮次消耗，耗尽后归还控制权", () => {
    const one = castTimedEffect({ type: "POSSESS", durationTurns: "1" }, false);
    expect(one.state.round).toBe(2);
    expect(one.target.possessedBy ?? null).toBeNull();

    const two = castTimedEffect({ type: "POSSESS", durationTurns: "2" }, false);
    expect(two.state.round).toBe(2);
    expect(two.target.possessedBy).toBe("caster");
    expect(two.target.possessCharges).toBe(1);
    two.caster.isReady = true;
    resolvePending(two.pack, two.state, {});
    expect(two.state.round).toBe(3);
    expect(two.target.possessedBy ?? null).toBeNull();
  });

  it("召唤物 duration=1 在下一轮开始时移除，duration=2 多保留一轮", () => {
    const one = castTimedEffect({ type: "SUMMON", name: "测试召唤物", count: "1", durationTicks: "1" }, true);
    expect(one.state.round).toBe(2);
    expect(one.state.participants.some((participant) => participant.summonedBy === "caster")).toBe(false);

    const two = castTimedEffect({ type: "SUMMON", name: "测试召唤物", count: "1", durationTicks: "2" }, true);
    expect(two.state.round).toBe(2);
    expect(two.state.participants.some((participant) => participant.summonedBy === "caster")).toBe(true);
    two.caster.isReady = true;
    resolvePending(two.pack, two.state, {});
    expect(two.state.round).toBe(3);
    expect(two.state.participants.some((participant) => participant.summonedBy === "caster")).toBe(false);
  });
});

describe("符卡战斗 SC 池", () => {
  function consume(state: CombatState, actor: CombatParticipantState, cardId: string, name: string): void {
    forceReady(actor);
    submitAction(state, {
      actorId: actor.id,
      kind: "SPELLCARD",
      name,
      spellCardId: cardId,
      spellcardMode: "CONSUMPTION",
      mpCost: 0
    });
    resolvePending(touhou, state);
  }

  it("一方 SC 池用完时无法再发动符卡", () => {
    const { state, a } = makeCombat("spellcard-pool");
    a.mp = 100;
    state.spellcardBattle = { sideUsable: { PC: 1, BOSS: 0 } };
    consume(state, a, "card-1", "符卡一");
    expect(a.usedSpellCards).toContain("card-1");

    consume(state, a, "card-2", "符卡二");
    expect(a.usedSpellCards).not.toContain("card-2");
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_POOL_EMPTY")).toBe(true);
  });

  it("友方共用同一 SC 池", () => {
    const { state, a, b } = makeCombat("spellcard-pool-shared");
    a.mp = 100;
    b.mp = 100;
    state.spellcardBattle = { sideUsable: { PC: 1, BOSS: 0 } };
    consume(state, a, "card-1", "符卡一");
    consume(state, b, "card-b", "魔理沙符卡");
    expect(b.usedSpellCards).not.toContain("card-b");
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_POOL_EMPTY")).toBe(true);
  });

  it("没有 SC 池信息时保持旧行为（不额外限制）", () => {
    const { state, a } = makeCombat("spellcard-pool-legacy");
    a.mp = 100;
    consume(state, a, "card-1", "符卡一");
    consume(state, a, "card-2", "符卡二");
    expect(a.usedSpellCards).toContain("card-2");
  });
});

describe("SC 回复 DP", () => {
  it("消费型 SC 发动时回复 DP 上限的一半（向上取整）", () => {
    const { state, a } = makeCombat("sc-dp-consumption");
    a.mp = 100;
    a.dp = 0;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "回灵符卡",
      spellCardId: "card-dp",
      spellcardMode: "CONSUMPTION",
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.dp).toBe(Math.ceil(a.maxDp / 2));
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_DP_RECOVER")).toBe(true);
  });

  it("展开型 SC 展开时回复 DP", () => {
    const { state, a } = makeCombat("sc-dp-declaration");
    a.mp = 100;
    a.dp = 0;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "展开符卡",
      spellCardId: "card-dp-decl",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.dp).toBe(Math.ceil(a.maxDp / 2));
    const recover = state.log.find((entry) => entry.data?.rollType === "SPELLCARD_DP_RECOVER");
    expect(recover?.data?.mode).toBe("DECLARATION");
  });
});

describe("LSC（Last Spell Card）", () => {
  it("宣告 LSC 后本场不能再使用符卡", () => {
    const { state, a } = makeCombat("lsc-use");
    a.mp = 100;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想天生",
      spellCardId: "card-lsc",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      declarationDurationTicks: 240,
      declarationLsc: true,
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.lscUsed).toBe(true);
    expect(a.declaration?.isLsc).toBe(true);
    expect(state.log.some((entry) => entry.data?.rollType === "LSC_DECLARED")).toBe(true);

    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "另一张符卡",
      spellCardId: "card-other",
      spellcardMode: "CONSUMPTION",
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.usedSpellCards).not.toContain("card-other");
    expect(state.log.some((entry) => entry.text.includes("已使用 LSC"))).toBe(true);
  });

  it("LSC 被击破时立刻气绝且 DP 上限归零", () => {
    const { state, a, b } = makeCombat("lsc-break");
    a.mp = 100;
    forceReady(a);
    forceReady(b);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "梦想天生",
      spellCardId: "card-lsc",
      spellcardMode: "DECLARATION",
      declarationHp: 5,
      declarationDurationTicks: 240,
      declarationLsc: true,
      mpCost: 0
    });
    submitAction(state, {
      actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "1d6+10"
    });
    resolvePending(touhou, state, { a: { type: "PASS" } });
    expect(a.declaration).toBeNull();
    expect(a.defeated).toBe(true);
    expect(a.unconscious).toBe(true);
    expect(a.lscBroken).toBe(true);
    expect(a.dp).toBe(0);
    expect(a.maxDp).toBe(0);
    expect(state.log.some((entry) => entry.data?.rollType === "LSC_BROKEN")).toBe(true);
  });
});

describe("战前 SC 宣言", () => {
  function consume(state: CombatState, actor: CombatParticipantState, cardId: string, name: string): void {
    forceReady(actor);
    submitAction(state, {
      actorId: actor.id,
      kind: "SPELLCARD",
      name,
      spellCardId: cardId,
      spellcardMode: "CONSUMPTION",
      mpCost: 0
    });
    resolvePending(touhou, state);
  }

  it("未宣言的符卡无法发动", () => {
    const { state, a } = makeCombat("sc-declared");
    a.mp = 100;
    state.spellcardBattle = { sideUsable: { PC: 2, BOSS: 0 }, declaredCardIds: { PC: ["card-declared"] } };
    consume(state, a, "card-other", "未宣言符卡");
    expect(a.usedSpellCards).not.toContain("card-other");
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_NOT_DECLARED")).toBe(true);

    consume(state, a, "card-declared", "已宣言符卡");
    expect(a.usedSpellCards).toContain("card-declared");
  });

  it("没有 declaredCardIds 时保持只按池上限限制", () => {
    const { state, a } = makeCombat("sc-no-declared");
    a.mp = 100;
    state.spellcardBattle = { sideUsable: { PC: 3, BOSS: 0 } };
    consume(state, a, "card-1", "符卡一");
    consume(state, a, "card-2", "符卡二");
    expect(a.usedSpellCards).toContain("card-1");
    expect(a.usedSpellCards).toContain("card-2");
  });
});

describe("主动放弃 SC（4.11）", () => {
  it("放弃展开中的符卡时，敌对阵营一人回复 DP", () => {
    const { state, a, npc } = makeCombat("abandon-sc");
    a.mp = 100;
    npc.dp = 0;
    forceReady(a);
    submitAction(state, {
      actorId: "a",
      kind: "SPELLCARD",
      name: "放弃测试",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    resolvePending(touhou, state);
    expect(a.declaration).not.toBeNull();

    forceReady(a);
    submitAction(state, { actorId: "a", kind: "PASS", abandonDeclaration: true });
    resolvePending(touhou, state);
    expect(a.declaration).toBeNull();
    expect(npc.dp).toBeGreaterThan(0);
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_ABANDONED")).toBe(true);
  });
});

describe("LSC 30 分钟后恢复 DP 上限", () => {
  it("到期的 LSC 后遗症恢复 DP 上限与初始值", () => {
    const { state, a } = makeCombat("lsc-recover");
    a.lscBroken = true;
    a.lscBrokenAt = new Date(Date.now() - 31 * 60_000).toISOString();
    a.dp = 0;
    a.maxDp = 0;
    const recovered = recoverTouhouLscLimits(touhou, state, Date.now());
    expect(recovered).toContain("a");
    expect(a.lscBroken).toBe(false);
    expect(a.maxDp).toBeGreaterThan(0);
    expect(a.dp).toBe(a.maxDp);
    expect(state.log.some((entry) => entry.data?.rollType === "LSC_DP_RECOVERED")).toBe(true);
  });

  it("未到期的 LSC 后遗症不恢复", () => {
    const { state, a } = makeCombat("lsc-not-due");
    a.lscBroken = true;
    a.lscBrokenAt = new Date(Date.now() - 5 * 60_000).toISOString();
    a.dp = 0;
    a.maxDp = 0;
    const recovered = recoverTouhouLscLimits(touhou, state, Date.now());
    expect(recovered).toEqual([]);
    expect(a.maxDp).toBe(0);
  });
});

describe("任意时机展开（4.9）", () => {
  it("反应窗口即时展开的 SC 会先承受本次攻击伤害", () => {
    const { state, a, npc } = makeCombat("immediate-sc");
    a.mp = 100;
    resolveSpellcardImmediate(touhou, state, "a", {
      actorId: "a",
      kind: "SPELLCARD",
      name: "即时展开",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    expect(a.declaration).not.toBeNull();
    expect(a.usedSpellCards).toContain("即时展开");

    forceReady(npc);
    submitAction(state, {
      actorId: "npc",
      kind: "DANMAKU",
      targetId: "a",
      skill: "DANMAKU",
      damage: "5"
    });
    resolvePending(touhou, state, { a: { type: "PASS" } });
    expect(a.hp).toBe(a.maxHp);
    expect(a.declaration?.hp).toBe(5);
  });

  it("池上限 / 未宣言等校验与普通符卡一致", () => {
    const { state, a } = makeCombat("immediate-sc-limited");
    a.mp = 100;
    state.spellcardBattle = { sideUsable: { PC: 1, BOSS: 0 }, declaredCardIds: { PC: ["card-ok"] } };
    resolveSpellcardImmediate(touhou, state, "a", {
      actorId: "a",
      kind: "SPELLCARD",
      name: "未宣言即时卡",
      spellCardId: "card-no",
      spellcardMode: "DECLARATION",
      declarationHp: 10,
      declarationDurationTicks: 240,
      mpCost: 0
    });
    expect(a.declaration).toBeNull();
    expect(state.log.some((entry) => entry.data?.rollType === "SPELLCARD_NOT_DECLARED")).toBe(true);
  });
});

describe("符卡战余量（4.16）", () => {
  it("按阵营统计可用 / 已用 / 剩余 SC 与存活人数", () => {
    const { state, a, npc } = makeCombat("sc-summary");
    state.spellcardBattle = {
      sideUsable: { PC: 2, BOSS: 1 },
      declaredCardIds: { PC: ["card-a"], BOSS: [] }
    };
    a.usedSpellCards = ["card-a"];
    const summary = spellcardBattleSummary(state);
    expect(summary).not.toBeNull();
    const pc = summary?.find((side) => side.side === "PC");
    const boss = summary?.find((side) => side.side === "BOSS");
    expect(pc?.usable).toBe(2);
    expect(pc?.used).toBe(1);
    expect(pc?.remaining).toBe(1);
    expect(pc?.alive).toBe(2);
    expect(boss?.remaining).toBe(1);
    void npc;
  });

  it("没有 declaredCardIds 时不是正式符卡战", () => {
    const { state } = makeCombat("sc-summary-none");
    state.spellcardBattle = { sideUsable: { PC: 2, BOSS: 1 } };
    expect(spellcardBattleSummary(state)).toBeNull();
  });
});

describe("结界（BARRIER）", () => {
  it("结界优先吸收伤害，击破时溢出无效", () => {
    const { state, a, b } = makeCombat("barrier-absorb");
    a.barrier = { hp: 10, maxHp: 10, name: "测试结界", expiresAtRound: null };
    forceReady(b);
    submitAction(state, { actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "6" });
    resolvePending(touhou, state, { a: { type: "PASS" } });
    expect(a.hp).toBe(a.maxHp);
    expect(a.barrier?.hp).toBe(4);

    forceReady(b);
    submitAction(state, { actorId: "b", kind: "DANMAKU", targetId: "a", skill: "DANMAKU", damage: "6" });
    resolvePending(touhou, state, { a: { type: "PASS" } });
    expect(a.hp).toBe(a.maxHp);
    expect(a.barrier).toBeNull();
    expect(state.log.some((entry) => entry.data?.rollType === "BARRIER_BROKEN")).toBe(true);
  });

  it("到期结界被清除", () => {
    const { state, a } = makeCombat("barrier-expire");
    a.barrier = { hp: 5, maxHp: 5, name: "限时结界", expiresAtRound: 2 };
    state.round = 1;
    expect(expireBarriers(state)).toEqual([]);
    state.round = 2;
    expect(expireBarriers(state)).toEqual(["a"]);
    expect(a.barrier).toBeNull();
    expect(state.log.some((entry) => entry.data?.rollType === "BARRIER_EXPIRED")).toBe(true);
  });
});
