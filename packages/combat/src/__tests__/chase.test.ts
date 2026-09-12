import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import {
  addParticipant,
  chaseAttackIssue,
  chaseCurrentActorId,
  chaseEndTurn,
  chaseMove,
  chaseWithdraw,
  chaseWithdrawIssue,
  createCombat,
  resolveChaseAttack,
  startChase
} from "../index";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const baseAttrs: AttributeSet = {
  str: 50, con: 50, siz: 50, dex: 80,
  app: 50, int: 50, pow: 50, edu: 50, luck: 50
};

function makeChaseState(preyDex = 80) {
  const state = createCombat({ id: "chase-test", seed: "chase-seed", tickMs: 250, mode: "INITIATIVE" });
  const derived = computeDerived(coc7, { attributes: baseAttrs }).derived;
  const prey = addParticipant(state, {
    id: "prey", name: "哈维", kind: "PLAYER", characterId: "char-prey", faction: "PC",
    attributes: { ...baseAttrs, dex: preyDex }, derived, skills: {},
    atbMax: 0, speed: 0
  });
  const chaser = addParticipant(state, {
    id: "chaser", name: "农夫", kind: "NPC", characterId: null, faction: "NPC",
    attributes: { ...baseAttrs, dex: 40 }, derived, skills: {},
    atbMax: 0, speed: 0
  });
  return { state, prey, chaser };
}

interface ContactChase {
  readonly state: ReturnType<typeof createCombat>;
  readonly prey: ReturnType<typeof addParticipant>;
  readonly chaser: ReturnType<typeof addParticipant>;
  readonly chase: NonNullable<ReturnType<typeof createCombat>["chase"]>;
  readonly preyEntry: NonNullable<ReturnType<typeof createCombat>["chase"]>["participants"][number];
  readonly chaserEntry: NonNullable<ReturnType<typeof createCombat>["chase"]>["participants"][number];
}

/** 建一场追逐，并让追逐者与逃离者处于同一地点、轮到追逐者行动。 */
function makeContactChase(): ContactChase {
  const { state, prey, chaser } = makeChaseState();
  startChase(coc7, state, {
    preyId: prey.id,
    chaserIds: [chaser.id],
    trackLength: 10,
    speedRolls: { prey: 60, chaser: 50 }
  });
  const chase = state.chase;
  if (chase === null) throw new Error("missing chase");
  const preyEntry = chase.participants.find((item) => item.id === prey.id);
  const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
  if (preyEntry === undefined || chaserEntry === undefined) throw new Error("missing chase participant");
  chaserEntry.position = preyEntry.position;
  chaserEntry.actionPoints = 2;
  chase.activeIndex = chase.order.indexOf(chaser.id);
  return { state, prey, chaser, chase, preyEntry, chaserEntry };
}

describe("COC7 追逐", () => {
  it("速度检定调整 MOV，并按相对 MOV 设置初始位置与行动点", () => {
    const { state, prey, chaser } = makeChaseState();
    const result = startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    expect(result.ok).toBe(true);
    expect(result.escapedImmediately).toBeUndefined();
    const chase = state.chase;
    expect(chase).not.toBeNull();
    if (chase === null) return;
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
    expect(preyEntry?.mov).toBe(7);
    expect(chaserEntry?.mov).toBe(8);
    expect(chaserEntry?.position).toBe(0);
    expect(preyEntry?.position).toBe(2);
    expect(preyEntry?.maxActionPoints).toBe(1);
    expect(chaserEntry?.maxActionPoints).toBe(2);
    expect(chase.order[0]).toBe("prey");
  });

  it("逃离者调整后 MOV 高于最快追逐者时直接逃离", () => {
    const { state, prey, chaser } = makeChaseState();
    const result = startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      speedRolls: { prey: 1, chaser: 100 }
    });
    expect(result.ok).toBe(true);
    expect(result.escapedImmediately).toBe(true);
    expect(state.chase).toBeNull();
  });

  it("移动消耗行动点；逃离者到达终点即逃脱", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 6,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    expect(chase).not.toBeNull();
    if (chase === null) return;
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    if (preyEntry === undefined) throw new Error("missing prey");
    preyEntry.actionPoints = 99;
    const escaped = chaseMove(state, prey.id, chase.trackLength - 1);
    expect(escaped.ok).toBe(true);
    expect(escaped.escaped).toBe(true);
    expect(chase.status).toBe("ESCAPED");
  });

  it("一轮结束后重置行动点并轮转顺序", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    if (chase === null) throw new Error("missing chase");
    const preyEntry = chase.participants.find((item) => item.id === prey.id);
    const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
    if (preyEntry === undefined || chaserEntry === undefined) throw new Error("missing participant");
    expect(preyEntry.actionPoints).toBe(1);
    expect(chaserEntry.actionPoints).toBe(2);
    preyEntry.actionPoints = 3;
    chaseMove(state, prey.id, 1);
    expect(preyEntry.actionPoints).toBe(2);
    const first = chaseEndTurn(state);
    expect(first.ok).toBe(true);
    expect(chase.activeIndex).toBe(1);
    const second = chaseEndTurn(state);
    expect(second.ok).toBe(true);
    expect(second.newRound).toBe(true);
    expect(chase.round).toBe(2);
    expect(preyEntry.actionPoints).toBe(preyEntry.maxActionPoints);
    expect(chaserEntry.actionPoints).toBe(chaserEntry.maxActionPoints);
  });

  it("同地点攻击消耗 1 行动点，并按攻击 / 应对 / 伤害结算", () => {
    const { state, prey, chaser, chase, chaserEntry } = makeContactChase();
    chaser.skills.FIGHTING_BRAWL = 100;
    prey.hp = 10;
    const hpBefore = prey.hp;
    const result = resolveChaseAttack(
      coc7,
      state,
      { actorId: chaser.id, targetId: prey.id, skill: "FIGHTING_BRAWL", damage: "1d6" },
      { [prey.id]: { type: "PASS" } }
    );
    expect(result.ok).toBe(true);
    expect(result.targetDefeated).toBe(false);
    expect(chaserEntry.actionPoints).toBe(1);
    expect(prey.hp).toBeLessThan(hpBefore);
    expect(state.log.some((entry) => entry.data?.rollType === "ATTACK")).toBe(true);
    expect(state.log.some((entry) => entry.data?.rollType === "DAMAGE_SETTLE")).toBe(true);
    expect(chase.status).toBe("ACTIVE");
    expect(state.phase).not.toBe("ENDED");
  });

  it("追逐攻击校验：非当前行动者 / 同阵营 / 不同地点 / 行动点不足", () => {
    const { state, prey, chaser, preyEntry, chaserEntry } = makeContactChase();
    expect(chaseAttackIssue(state, prey.id, chaser.id)).toContain("还没轮到");
    expect(chaseAttackIssue(state, chaser.id, chaser.id)).toContain("敌对阵营");
    preyEntry.position += 1;
    expect(chaseAttackIssue(state, chaser.id, prey.id)).toContain("同一地点");
    preyEntry.position -= 1;
    chaserEntry.actionPoints = 0;
    expect(chaseAttackIssue(state, chaser.id, prey.id)).toContain("行动点不足");
  });

  it("追逐回合会跳过已失去战斗能力的参与者", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    if (chase === null) throw new Error("missing chase");
    expect(chase.order[0]).toBe(prey.id);
    expect(chase.order[1]).toBe(chaser.id);
    chaser.defeated = true;
    const result = chaseEndTurn(state);
    expect(result.ok).toBe(true);
    expect(result.newRound).toBe(true);
    expect(result.nextActorId).toBe(prey.id);
    expect(chase.activeIndex).toBe(0);
  });

  it("击败逃离者后追逐判定 CAUGHT 并结束战斗", () => {
    const { state, prey, chaser, chase } = makeContactChase();
    chaser.skills.FIGHTING_BRAWL = 100;
    prey.hp = 1;
    const result = resolveChaseAttack(
      coc7,
      state,
      { actorId: chaser.id, targetId: prey.id, skill: "FIGHTING_BRAWL", damage: "1d6" },
      { [prey.id]: { type: "PASS" } }
    );
    expect(result.ok).toBe(true);
    expect(result.targetDefeated).toBe(true);
    expect(result.chaseEnded).toBe(true);
    expect(result.combatEnded).toBe(true);
    expect(chase.status).toBe("CAUGHT");
    expect(state.phase).toBe("ENDED");
  });

  it("最后一名追逐者放弃追逐时判定 ESCAPED 并结束战斗", () => {
    const { state, chaser, chase, chaserEntry } = makeContactChase();
    const result = chaseWithdraw(state, chaser.id, "前方是邪教据点");
    expect(result.ok).toBe(true);
    expect(result.escaped).toBe(true);
    expect(result.chaseEnded).toBe(true);
    expect(result.combatEnded).toBe(true);
    expect(chaserEntry.withdrawn).toBe(true);
    expect(chase.status).toBe("ESCAPED");
    expect(state.phase).toBe("ENDED");
  });

  it("仍有同伙继续追时，追方放弃只退出名单并轮转到下一个行动者", () => {
    const { state, prey, chaser } = makeChaseState();
    const derived = computeDerived(coc7, {
      attributes: { ...baseAttrs, dex: 30 }
    }).derived;
    const chaser2 = addParticipant(state, {
      id: "chaser-2",
      name: "农夫乙",
      kind: "NPC",
      characterId: null,
      faction: "NPC",
      attributes: { ...baseAttrs, dex: 30 },
      derived,
      skills: {},
      atbMax: 0,
      speed: 0
    });
    const started = startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id, chaser2.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50, "chaser-2": 60 }
    });
    expect(started.ok).toBe(true);
    const chase = state.chase;
    if (chase === null) throw new Error("missing chase");
    const chaserEntry = chase.participants.find((item) => item.id === chaser.id);
    if (chaserEntry === undefined) throw new Error("missing chaser");
    chase.activeIndex = chase.order.indexOf(chaser.id);
    expect(chaseCurrentActorId(chase)).toBe(chaser.id);

    const result = chaseWithdraw(state, chaser.id, "去追另一个目标");
    expect(result.ok).toBe(true);
    expect(result.escaped).toBeUndefined();
    expect(result.chaseEnded).toBeUndefined();
    expect(chaserEntry.withdrawn).toBe(true);
    expect(chase.status).toBe("ACTIVE");
    expect(chaseCurrentActorId(chase)).toBe(chaser2.id);
    expect(state.phase).not.toBe("ENDED");
  });

  it("逃方放弃逃跑时判定 CAUGHT 并结束战斗", () => {
    const { state, prey, chaser } = makeChaseState();
    startChase(coc7, state, {
      preyId: prey.id,
      chaserIds: [chaser.id],
      trackLength: 10,
      speedRolls: { prey: 60, chaser: 50 }
    });
    const chase = state.chase;
    if (chase === null) throw new Error("missing chase");
    expect(chaseCurrentActorId(chase)).toBe(prey.id);
    const result = chaseWithdraw(state, prey.id);
    expect(result.ok).toBe(true);
    expect(result.caught).toBe(true);
    expect(chase.status).toBe("CAUGHT");
    expect(state.phase).toBe("ENDED");
  });

  it("非当前行动者不能放弃追逐，退出后不能继续移动", () => {
    const { state, prey, chaser, chase, chaserEntry } = makeContactChase();
    expect(chaseWithdrawIssue(state, prey.id)).toContain("只能在自己的回合");
    const result = chaseWithdraw(state, chaser.id);
    expect(result.ok).toBe(true);
    expect(chase.status).toBe("ESCAPED");
    expect(chaserEntry.withdrawn).toBe(true);
    const move = chaseMove(state, chaser.id, 1);
    expect(move.ok).toBe(false);
    expect(move.error).toContain("没有进行中的追逐");
  });
});
