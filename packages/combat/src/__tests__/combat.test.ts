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
  filterCombatForViewer,
  reactionTargetIdsForAction,
  resolvePending,
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

  it("防御消耗灵力并完全吸收低伤害", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    const mpBefore = b.mp;
    resolvePending(touhou, state, { b: { type: "DEFEND" } });
    expect(b.hp).toBe(b.maxHp);
    expect(b.mp).toBe(mpBefore - 10);
  });

  it("擦弹成功免伤并回复灵力", () => {
    const { state, b } = makeCombat();
    advanceToNextEvent(touhou, state);
    submitAction(state, {
      actorId: "a", kind: "DANMAKU", targetId: "b", skill: "DANMAKU", damage: "2d6"
    });
    b.mp = 10;
    resolvePending(touhou, state, { b: { type: "DODGE", skill: "DODGE" } });
    expect(b.hp).toBe(b.maxHp);
    expect(b.mp).toBeGreaterThan(10);
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
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(state.log.some((entry) => entry.text.includes("被击破"))).toBe(true);
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
    const e1 = addParticipant(state, {
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

