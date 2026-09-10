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
  advanceToNextEvent,
  applyStatus,
  createCombat,
  filterCombatForViewer,
  resolvePending,
  submitAction,
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

  it("PL 看不到未识别 NPC 的名字与数值，只看到文字描述", () => {
    const { state } = makeCombat();
    const view = filterCombatForViewer(state, {
      userId: "u1", role: "PLAYER", characterId: "char-a"
    });
    const npc = view.participants.find((p) => p.kind === "NPC");
    expect(npc?.name).toBe("???");
    expect(npc?.faction).toBeNull();
    expect(npc?.hp).toBeNull();
    expect(npc?.maxHp).toBeNull();
    expect(npc?.hpText).toBe("完好");
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
});
