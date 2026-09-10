import { describe, expect, it } from 'vitest';
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet
} from '@touhou/rules';
import {
  addParticipant,
  beginInitiativeRound,
  buildInitiativeOrder,
  createCombat,
  currentActorId,
  endTurn,
  setInitiativeOrder,
  type CombatState
} from '../index';

const coc = compileParsedRulePack(resolveRulePack('coc7-baseline', builtinRegistry()));
const touhou = compileParsedRulePack(resolveRulePack('touhou-ext', builtinRegistry()));

function attrs(dex: number): AttributeSet {
  return { str: 50, con: 50, siz: 50, dex, app: 50, int: 50, pow: 50, edu: 50, luck: 50 };
}

function setup(dexList: readonly number[]): CombatState {
  const state = createCombat({ id: 'c1', seed: 'init-seed', tickMs: 250, mode: 'INITIATIVE' });
  dexList.forEach((dex, index) => {
    const attributes = attrs(dex);
    const derived = computeDerived(coc, { attributes }).derived;
    addParticipant(state, {
      id: 'p' + String(index + 1),
      name: 'P' + String(index + 1),
      kind: 'PLAYER',
      // 至少两个阵营，否则 checkEnd 会判定战斗直接结束
      faction: index % 2 === 0 ? 'PC' : 'ENEMY',
      attributes,
      derived,
      atbMax: computeAtbMax(coc, { dex }),
      speed: computeBaseSpeed(coc, { dex })
    });
  });
  return state;
}

describe('INITIATIVE 出手顺序', () => {
  it('按 DEX 从高到低排列', () => {
    const state = setup([40, 80, 60]);
    expect(buildInitiativeOrder(coc, state)).toEqual(['p2', 'p3', 'p1']);
  });

  it('同 DEX 时排序结果稳定', () => {
    const state = setup([50, 50, 50]);
    const first = buildInitiativeOrder(coc, state);
    const second = buildInitiativeOrder(coc, state);
    expect(first).toEqual(second);
  });

  it('倒地的人不进入顺序', () => {
    const state = setup([90, 50, 30]);
    const dead = state.participants[0];
    if (dead !== undefined) dead.defeated = true;
    expect(buildInitiativeOrder(coc, state)).toEqual(['p2', 'p3']);
  });
});

describe('INITIATIVE 轮次推进', () => {
  it('开局把指针归零并进入等待行动', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(coc, state);
    expect(state.round).toBe(1);
    expect(state.activeIndex).toBe(0);
    expect(currentActorId(state)).toBe('p1');
    expect(state.phase).toBe('AWAITING_ACTION');
  });

  it('依次轮转，走完一轮自动重排并进入下一轮', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(coc, state);

    expect(endTurn(coc, state).nextActorId).toBe('p2');
    expect(state.round).toBe(1);
    expect(endTurn(coc, state).nextActorId).toBe('p3');
    expect(state.round).toBe(1);

    const wrapped = endTurn(coc, state);
    expect(wrapped.roundAdvanced).toBe(true);
    expect(state.round).toBe(2);
    expect(wrapped.nextActorId).toBe('p1');
  });

  it('中途倒地的人从顺序里剔除', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(coc, state);
    const second = state.participants[1];
    if (second !== undefined) second.defeated = true;
    const step = endTurn(coc, state);
    expect(step.nextActorId).toBe('p3');
    expect(state.initiativeOrder).toEqual(['p1', 'p3']);
  });
});

describe('KP 调序权限由规则包决定', () => {
  it('COC7 允许 KP 手动调序', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(coc, state);
    expect(setInitiativeOrder(coc, state, ['p3', 'p1', 'p2'])).toBe(true);
    expect(currentActorId(state)).toBe('p3');
  });

  it('东方包不允许 KP 调序', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(touhou, state);
    expect(setInitiativeOrder(touhou, state, ['p3', 'p1', 'p2'])).toBe(false);
  });

  it('调序时拒绝未知 id 或长度不符', () => {
    const state = setup([80, 60, 40]);
    beginInitiativeRound(coc, state);
    expect(setInitiativeOrder(coc, state, ['p9', 'p1', 'p2'])).toBe(false);
    expect(setInitiativeOrder(coc, state, ['p1', 'p2'])).toBe(false);
  });
});
