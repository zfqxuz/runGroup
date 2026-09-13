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
  createCombat,
  currentActorId,
  endTurn,
  resolveInitiativeTurn,
  submitAction,
  type CombatState
} from '../index';

const coc = compileParsedRulePack(resolveRulePack('coc7-baseline', builtinRegistry()));

function attrs(dex: number): AttributeSet {
  return { str: 50, con: 50, siz: 50, dex, app: 50, int: 50, pow: 50, edu: 50, luck: 50 };
}

function setup(): CombatState {
  const state = createCombat({ id: 'c1', seed: 'turn-seed', tickMs: 250, mode: 'INITIATIVE' });
  [80, 60, 40].forEach((dex, index) => {
    const attributes = attrs(dex);
    const derived = computeDerived(coc, { attributes }).derived;
    addParticipant(state, {
      id: 'p' + String(index + 1),
      name: 'P' + String(index + 1),
      kind: 'PLAYER',
      faction: index % 2 === 0 ? 'PC' : 'ENEMY',
      attributes,
      derived,
      atbMax: computeAtbMax(coc, { dex }),
      speed: computeBaseSpeed(coc, { dex })
    });
  });
  return state;
}

describe('INITIATIVE 按顺序结算', () => {
  it('轮到时只有当前行动者被标记就绪', () => {
    const state = setup();
    beginInitiativeRound(coc, state);
    expect(currentActorId(state)).toBe('p1');
    expect(state.participants[0]?.isReady).toBe(true);
    expect(state.participants[1]?.isReady).toBe(false);
  });

  it('只结算当前行动者，其他人的提交原样保留', () => {
    const state = setup();
    beginInitiativeRound(coc, state);

    expect(submitAction(state, { actorId: 'p1', kind: 'PASS' })).toBe(true);
    // p2 还没轮到，submitAction 会被拒
    expect(submitAction(state, { actorId: 'p2', kind: 'PASS' })).toBe(false);

    const result = resolveInitiativeTurn(coc, state);
    expect(result.acted).toEqual(['p1']);
    expect(state.participants[0]?.isReady).toBe(false);
  });

  it('交棒后下一个人才就绪', () => {
    const state = setup();
    beginInitiativeRound(coc, state);
    submitAction(state, { actorId: 'p1', kind: 'PASS' });
    resolveInitiativeTurn(coc, state);

    const step = endTurn(coc, state);
    expect(step.nextActorId).toBe('p2');
    expect(state.participants[1]?.isReady).toBe(true);
    expect(state.participants[0]?.isReady).toBe(false);
  });

  it('COC7 反击使用斗殴基础值 25，即使卡面没有写技能', () => {
    const state = setup();
    const attacker = state.participants[0];
    const defender = state.participants[1];
    if (attacker === undefined || defender === undefined) throw new Error('missing participant');
    attacker.skills.FIGHTING_BRAWL = 80;
    defender.skills = {};
    beginInitiativeRound(coc, state);
    expect(submitAction(state, { actorId: 'p1', kind: 'DANMAKU', targetId: 'p2', skill: 'FIGHTING_BRAWL', damage: '1d6' })).toBe(true);
    resolveInitiativeTurn(coc, state, { p2: { type: 'COUNTER', skill: 'FIGHTING_BRAWL' } });
    const counter = state.log.find((entry) => entry.data?.rollType === 'COUNTER');
    expect(counter?.data?.counterTarget).toBe(25);
  });

  it('COC7 反击应对可以完成结算', () => {
    const state = setup();
    const attacker = state.participants[0];
    const defender = state.participants[1];
    if (attacker === undefined || defender === undefined) throw new Error('missing participant');
    attacker.skills.FIGHTING_BRAWL = 80;
    defender.skills.FIGHTING_BRAWL = 80;
    beginInitiativeRound(coc, state);
    expect(submitAction(state, { actorId: 'p1', kind: 'DANMAKU', targetId: 'p2', skill: 'FIGHTING_BRAWL', damage: '1d6' })).toBe(true);
    const result = resolveInitiativeTurn(coc, state, { p2: { type: 'COUNTER', skill: 'FIGHTING_BRAWL' } });
    expect(result.acted).toEqual(['p1']);
    expect(state.pending.p1).toBeUndefined();
    expect(state.log.some((entry) => entry.data?.rollType === 'COUNTER' || entry.data?.rollType === 'DAMAGE_SETTLE')).toBe(true);
  });

  it('没提交行动也能交棒（视为跳过）', () => {
    const state = setup();
    beginInitiativeRound(coc, state);
    const result = resolveInitiativeTurn(coc, state);
    expect(result.acted).toEqual([]);
    expect(endTurn(coc, state).nextActorId).toBe('p2');
  });
});
