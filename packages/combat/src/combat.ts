import {
  evaluate,
  compile as compileExpr,
  parseDice,
  rollDice,
  rollDie,
  type Rng
} from "@touhou/formula";
import {
  advanceTicks,
  applyDamagePipeline,
  consumeAction,
  isSuccess,
  resolveCheck,
  resolveOpposed,
  resolveActionCost,
  damageMultiplierOf,
  fromMicro,
  schedule,
  speedMultiplierOf,
  type AttributeSet,
  type CompiledRulePack,
  type DefenseType,
  type DerivedStats
} from "@touhou/rules";
import { rngFor } from "./rng";
import type {
  ActionSubmission,
  CombatMode,
  CombatParticipantState,
  CombatState,
  LogEntry
} from "./types";

export const DEFAULT_ATB_SCALE = 1000;

export function nextSeq(state: CombatState): number {
  state.seq += 1;
  return state.seq;
}

export function pushLog(
  state: CombatState,
  entry: Omit<LogEntry, "seq" | "tick">
): LogEntry {
  const full: LogEntry = { ...entry, seq: nextSeq(state), tick: state.tick };
  state.log.push(full);
  return full;
}

export function findParticipant(
  state: CombatState,
  id: string
): CombatParticipantState | undefined {
  return state.participants.find((participant) => participant.id === id);
}

export interface CombatInit {
  readonly id: string;
  readonly seed: string;
  readonly tickMs: number;
  /** 缺省 ATB，COC7 房间应显式传 INITIATIVE。 */
  readonly mode?: CombatMode;
}

export function createCombat(init: CombatInit): CombatState {
  return {
    id: init.id,
    seed: init.seed,
    tickMs: init.tickMs,
    mode: init.mode ?? 'ATB',
    initiativeOrder: [],
    activeIndex: 0,
    tick: 0,
    round: 1,
    phase: "ATB_CHARGING",
    seq: 0,
    rollSeq: 0,
    participants: [],
    pending: {},
    log: []
  };
}

export interface ParticipantInit {
  readonly id: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
  readonly characterId?: string | null;
  readonly faction: string;
  readonly attributes: AttributeSet;
  readonly derived: DerivedStats;
  readonly skills?: Record<string, number>;
  /** 单位 1/ATB_SCALE。 */
  readonly atbMax: number;
  readonly speed: number;
  readonly isIdentified?: boolean;
}

export function addParticipant(
  state: CombatState,
  init: ParticipantInit
): CombatParticipantState {
  const vars: Record<string, number> = {};
  for (const [key, value] of Object.entries(init.attributes)) vars[key] = value;
  for (const [key, value] of Object.entries(init.derived)) vars[key] = value;
  vars.atbMax = fromMicro(init.atbMax);

  const participant: CombatParticipantState = {
    id: init.id,
    name: init.name,
    kind: init.kind,
    characterId: init.characterId ?? null,
    faction: init.faction,
    atbValue: 0,
    atbMax: init.atbMax,
    baseSpeed: init.speed,
    speed: init.speed,
    isReady: false,
    defeated: false,
    hp: init.derived.maxHp,
    maxHp: init.derived.maxHp,
    mp: init.derived.maxMp,
    maxMp: init.derived.maxMp,
    san: init.derived.maxSan,
    maxSan: init.derived.maxSan,
    dp: init.derived.maxDp,
    maxDp: init.derived.maxDp,
    attributes: init.attributes,
    derived: init.derived,
    skills: init.skills ?? {},
    vars,
    statusEffects: [],
    declaration: null,
    usedSpellCards: [],
    isIdentified: init.isIdentified ?? init.kind === "PLAYER"
  };
  state.participants.push(participant);
  return participant;
}

export function readyParticipants(state: CombatState): CombatParticipantState[] {
  return state.participants.filter((p) => !p.defeated && p.isReady);
}

export function recomputeSpeed(
  pack: CompiledRulePack,
  participant: CombatParticipantState
): void {
  const multiplier = speedMultiplierOf(pack, participant.statusEffects, participant.vars);
  participant.speed = Math.max(0, Math.round(participant.baseSpeed * multiplier));
}

export function applyStatus(
  pack: CompiledRulePack,
  state: CombatState,
  participantId: string,
  key: string,
  stacks = 1
): void {
  const participant = findParticipant(state, participantId);
  const rule = pack.statusEffects[key];
  if (participant === undefined || rule === undefined || participant.defeated) return;

  // 配置里的时长单位就是计数 —— 整个系统只有一个时间单位。
  const durationTicks = Math.max(
    1,
    Math.floor(evaluate(rule.durationTicks, { vars: participant.vars, consts: pack.pack.const }))
  );
  const count = Math.max(1, stacks);
  const existing = participant.statusEffects.find((effect) => effect.key === key);

  if (rule.stack === "REPLACE") {
    participant.statusEffects = [
      ...participant.statusEffects.filter((effect) => effect.key !== key),
      { key, stacks: 1, remainingTicks: durationTicks }
    ];
  } else if (existing === undefined) {
    participant.statusEffects = [
      ...participant.statusEffects,
      { key, stacks: Math.min(rule.maxStacks, count), remainingTicks: durationTicks }
    ];
  } else if (rule.stack === "REFRESH") {
    participant.statusEffects = participant.statusEffects.map((effect) =>
      effect.key === key
        ? { ...effect, remainingTicks: Math.max(effect.remainingTicks, durationTicks) }
        : effect
    );
  } else {
    participant.statusEffects = participant.statusEffects.map((effect) =>
      effect.key === key
        ? {
            ...effect,
            stacks: Math.min(rule.maxStacks, effect.stacks + count),
            remainingTicks: durationTicks
          }
        : effect
    );
  }

  recomputeSpeed(pack, participant);
  pushLog(state, {
    kind: "STATUS",
    actorId: participant.id,
    targetId: participant.id,
    text: `${participant.name} 获得状态 ${key} x${count}`,
    data: { key, stacks: count }
  });
}

function expireTimedEffects(
  pack: CompiledRulePack,
  state: CombatState,
  ticks: number
): void {
  for (const participant of state.participants) {
    if (participant.defeated) continue;

    if (participant.statusEffects.length > 0) {
      participant.statusEffects = participant.statusEffects
        .map((effect) => ({ ...effect, remainingTicks: effect.remainingTicks - ticks }))
        .filter((effect) => effect.remainingTicks > 0);
      recomputeSpeed(pack, participant);
    }

    const declaration = participant.declaration;
    if (declaration !== null && state.tick >= declaration.expiresAtTick) {
      participant.declaration = null;
      pushLog(state, {
        kind: "SPELLCARD",
        actorId: participant.id,
        targetId: null,
        text: `${participant.name} 的符卡「${declaration.name}」持续时间结束`
      });
    }
  }
}

export interface AdvanceResult {
  readonly ticks: number;
  readonly ms: number;
  readonly readyIds: readonly string[];
}

/**
 * 推进全局计数器到下一个就绪事件。
 * 服务端只需在返回的 ms 之后唤醒一次，静默期间零消息。
 */
export function advanceToNextEvent(
  pack: CompiledRulePack,
  state: CombatState
): AdvanceResult {
  if (state.phase === "ENDED") return { ticks: 0, ms: 0, readyIds: [] };

  const alreadyReady = readyParticipants(state);
  if (alreadyReady.length > 0) {
    state.phase = "AWAITING_ACTION";
    return { ticks: 0, ms: 0, readyIds: alreadyReady.map((p) => p.id) };
  }

  const alive = state.participants.filter((p) => !p.defeated);
  const plan = schedule(alive, state.tickMs);
  if (!Number.isFinite(plan.ticks) || plan.ticks <= 0) {
    return { ticks: 0, ms: 0, readyIds: [] };
  }

  advanceTicks(alive, plan.ticks);
  state.tick += plan.ticks;
  expireTimedEffects(pack, state, plan.ticks);
  state.phase = readyParticipants(state).length > 0 ? "AWAITING_ACTION" : "ATB_CHARGING";
  return { ticks: plan.ticks, ms: plan.ms, readyIds: plan.ready };
}

export function nextRollRng(state: CombatState, salt = ""): Rng {
  state.rollSeq += 1;
  return rngFor(state.seed, state.rollSeq, salt);
}

export function submitAction(state: CombatState, submission: ActionSubmission): boolean {
  if (state.phase === "ENDED") return false;
  const actor = findParticipant(state, submission.actorId);
  if (actor === undefined || actor.defeated || actor.isReady === false) return false;
  state.pending[submission.actorId] = submission;
  state.phase = "AWAITING_ACTION";
  return true;
}

export interface DefenseReaction {
  readonly type: DefenseType;
  readonly skill?: string;
}

export interface ResolveResult {
  readonly acted: readonly string[];
  readonly defeated: readonly string[];
  readonly cleared: readonly string[];
}

interface ResolveContext {
  readonly pack: CompiledRulePack;
  readonly state: CombatState;
  readonly reactions: Readonly<Record<string, DefenseReaction>>;
  readonly queue: ActionSubmission[];
  readonly cancelled: Set<string>;
}

function reactionFor(ctx: ResolveContext, defenderId: string): DefenseReaction {
  return ctx.reactions[defenderId] ?? { type: "PASS" };
}

function disabledReactionFor(pack: CompiledRulePack, defense: DefenseType): string | null {
  if (defense === "DODGE") {
    const event = pack.pack.combat.events.GRAZE;
    if (event && event.defaultEnabled === false) return "擦弹";
  }
  if (defense === "COUNTER") {
    const event = pack.pack.combat.events.COUNTER;
    if (event && event.defaultEnabled === false) return "消弹";
  }
  return null;
}

function evaluateSource(pack: CompiledRulePack, source: string, vars: Record<string, number>): number {
  const expression = compileExpr(source, { vars: Object.keys(vars), consts: pack.constantNames });
  return evaluate(expression, { vars, consts: pack.pack.const });
}

function breakDeclaration(ctx: ResolveContext, owner: CombatParticipantState): void {
  const declaration = owner.declaration;
  if (declaration === null) return;
  owner.declaration = null;

  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: owner.id,
    targetId: null,
    text: `${owner.name} 的符卡「${declaration.name}」被击破`
  });

  const rules = ctx.pack.pack.spellcard;
  if (rules === undefined) return;
  const clearEvent = ctx.pack.pack.combat.events.SPELLCARD_BREAK_CLEARS_DANMAKU;
  if (clearEvent && clearEvent.defaultEnabled === false) return;
  if (rules.declaration.onBreakClearDanmaku === false) return;

  const mode = rules.declaration.clearTargets;
  for (const submission of ctx.queue) {
    if (submission.kind !== "DANMAKU") continue;
    if (mode === "OTHERS_ONLY" && submission.actorId === owner.id) continue;
    ctx.cancelled.add(submission.actorId);
  }
}

function applyDamageToParticipant(
  ctx: ResolveContext,
  target: CombatParticipantState,
  amount: number
): { toDeclaration: number; toHp: number } {
  let remaining = amount;
  let toDeclaration = 0;

  const declaration = target.declaration;
  if (declaration !== null) {
    const absorbed = Math.min(declaration.hp, remaining);
    declaration.hp -= absorbed;
    toDeclaration = absorbed;
    remaining -= absorbed;
    if (declaration.hp <= 0) breakDeclaration(ctx, target);
  }

  let toHp = 0;
  if (remaining > 0) {
    toHp = Math.min(target.hp, remaining);
    target.hp -= toHp;
    if (target.hp <= 0) {
      target.hp = 0;
      target.defeated = true;
      target.isReady = false;
      pushLog(ctx.state, {
        kind: "DEFEAT",
        actorId: target.id,
        targetId: target.id,
        text: `${target.name} 失去战斗能力`
      });
    }
  }

  return { toDeclaration, toHp };
}

function skillValueOf(
  participant: CombatParticipantState,
  skill: string | undefined,
  fallback: number
): number {
  if (skill === undefined) return fallback;
  return participant.skills[skill] ?? fallback;
}

function resolveAttack(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  defender: CombatParticipantState
): void {
  const state = ctx.state;
  const rng = nextRollRng(state, `attack:${actor.id}`);
  const skillName = submission.skill ?? "DANMAKU";
  const target = (actor.skills[skillName] ?? 0) + (submission.accuracyMod ?? 0);
  const attackRoll = rollDie(rng, 100);
  const attackCheck = resolveCheck(ctx.pack, attackRoll, target);

  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text: `${actor.name} 的 ${skillName} 判定 ${attackRoll}/${target} → ${attackCheck.result}`,
    data: { roll: attackRoll, target, result: attackCheck.result }
  });

  if (isSuccess(attackCheck.result) === false) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: `${actor.name} 的攻击落空`
    });
    return;
  }

  let reaction = reactionFor(ctx, defender.id);
  const blockedEvent = disabledReactionFor(ctx.pack, reaction.type);
  if (blockedEvent) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: defender.id,
      targetId: actor.id,
      text: defender.name + " 的 " + blockedEvent + " 已被本房禁用，按普通应对结算"
    });
    reaction = { type: "PASS" };
  }
  let defenseSuccess = false;

  if (reaction.type === "DODGE") {
    const dodgeTarget = skillValueOf(defender, reaction.skill ?? "DODGE", defender.attributes.dex);
    const dodgeRoll = rollDie(rng, 100);
    const dodgeCheck = resolveCheck(ctx.pack, dodgeRoll, dodgeTarget);
    defenseSuccess = isSuccess(dodgeCheck.result);
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text: `${defender.name} 擦弹判定 ${dodgeRoll}/${dodgeTarget} → ${dodgeCheck.result}`,
      data: { roll: dodgeRoll, target: dodgeTarget, result: dodgeCheck.result }
    });
  } else if (reaction.type === "COUNTER") {
    const counterTarget = skillValueOf(defender, reaction.skill ?? "DANMAKU", defender.attributes.dex);
    const counterRoll = rollDie(rng, 100);
    const opposed = resolveOpposed(
      ctx.pack,
      { roll: attackRoll, target },
      { roll: counterRoll, target: counterTarget }
    );
    defenseSuccess = opposed.winner === "DEFENDER";
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text: `${defender.name} 消弹对抗 ${counterRoll}/${counterTarget} → ${defenseSuccess ? "成功" : "失败"}`,
      data: { roll: counterRoll, target: counterTarget, success: defenseSuccess }
    });
  }

  const damageRoll = rollDice(parseDice(submission.damage ?? "0"), rng);
  const shieldMultiplier = damageMultiplierOf(ctx.pack, defender.statusEffects, defender.vars);

  const outcome = applyDamagePipeline(ctx.pack, {
    baseDamage: damageRoll.total,
    defense: reaction.type,
    defenseSuccess,
    shieldMultiplier,
    vars: defender.vars
  });

  if (outcome.mpCost > 0) defender.mp = Math.max(0, defender.mp - outcome.mpCost);
  if (outcome.mpGained > 0) {
    defender.mp = Math.min(defender.maxMp, defender.mp + outcome.mpGained);
  }

  const applied = applyDamageToParticipant(ctx, defender, outcome.damage);

  pushLog(state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: defender.id,
    text: `${actor.name} → ${defender.name} 伤害 ${outcome.damage}（符卡吸收 ${applied.toDeclaration} / 本体 ${applied.toHp}）`,
    data: {
      damage: outcome.damage,
      toDeclaration: applied.toDeclaration,
      toHp: applied.toHp,
      mpCost: outcome.mpCost,
      mpGained: outcome.mpGained
    }
  });
}

function resolveSpellcard(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const rules = ctx.pack.pack.spellcard;
  if (rules === undefined) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: "本规则包未定义符卡规则"
    });
    return;
  }

  const name = submission.name ?? "无名符卡";
  const mode = submission.spellcardMode ?? "DECLARATION";
  const mpCost = Math.max(0, submission.mpCost ?? 0);

  if (mode === "CONSUMPTION") {
    if (rules.consumption.oncePerCombat === true && actor.usedSpellCards.includes(name)) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: `${actor.name} 的消费型符卡「${name}」本场已使用过`
      });
      return;
    }
    actor.usedSpellCards = [...actor.usedSpellCards, name];
    actor.mp = Math.max(0, actor.mp - mpCost);
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: submission.targetId ?? null,
      text: `${actor.name} 发动消费型符卡「${name}」，附带消弹`
    });
    for (const queued of ctx.queue) {
      if (queued.kind !== "DANMAKU") continue;
      if (queued.actorId === actor.id) continue;
      ctx.cancelled.add(queued.actorId);
    }
    return;
  }

  const declarationHp = submission.declarationHp ?? 0;
  if (declarationHp <= 0) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: `${actor.name} 展开「${name}」失败：缺少独立 HP`
    });
    return;
  }
  if (actor.declaration !== null) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: `${actor.name} 已有展开中的符卡`
    });
    return;
  }
  if (actor.mp < mpCost) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: `${actor.name} 灵力不足，无法展开「${name}」`
    });
    return;
  }

  actor.mp -= mpCost;
  const rawDuration = Math.max(0, Math.floor(submission.declarationDurationTicks ?? 0));
  const durationTicks = rawDuration > 0 ? Math.max(1, rawDuration) : Number.POSITIVE_INFINITY;

  actor.declaration = {
    name,
    hp: declarationHp,
    maxHp: declarationHp,
    expiresAtTick: state.tick + durationTicks,
    clearTargets: rules.declaration.clearTargets,
    damageMultiplier: 1
  };

  pushLog(state, {
    kind: "SPELLCARD",
    actorId: actor.id,
    targetId: null,
    text: `${actor.name} 展开符卡「${name}」，独立 HP ${declarationHp}`,
    data: { name, hp: declarationHp, durationTicks: Number.isFinite(durationTicks) ? durationTicks : -1 }
  });
}

function resolveOutOfRule(ctx: ResolveContext, actor: CombatParticipantState, submission: ActionSubmission): void {
  const rules = ctx.pack.pack.spellcard;
  if (rules === undefined) {
    pushLog(ctx.state, { kind: "SYSTEM", actorId: actor.id, targetId: null, text: "本规则包未定义规则外施法" });
    return;
  }
  const event = ctx.pack.pack.combat.events.OUT_OF_RULE_SPELL;
  if (event === undefined || event.defaultEnabled === false) {
    pushLog(ctx.state, { kind: "SYSTEM", actorId: actor.id, targetId: null, text: "本房已禁用规则外施法" });
    return;
  }
  const name = submission.name ?? "规则外施法";
  let sanCost = 0;
  try {
    sanCost = Math.max(0, rollDice(parseDice(rules.outOfRule.sanCost), nextRollRng(ctx.state, "out-of-rule:" + actor.id)).total);
  } catch {
    sanCost = 0;
  }
  const mpCost = Math.max(0, Math.floor(evaluateSource(ctx.pack, rules.outOfRule.mpCost, actor.vars)));
  actor.mp = Math.max(0, actor.mp - mpCost);
  actor.san = Math.max(0, actor.san - sanCost);
  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: actor.id,
    targetId: submission.targetId ?? null,
    text: actor.name + " 施放规则外法术「" + name + "」，消耗 MP " + mpCost + " / SAN " + sanCost,
    data: { name, mpCost, sanCost }
  });
}

function resolveOne(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const targetId = submission.targetId ?? null;

  switch (submission.kind) {
    case "OUT_OF_RULE":
      resolveOutOfRule(ctx, actor, submission);
      return;
    case "PASS":
      pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: `${actor.name} 跳过本回合` });
      return;
    case "FLEE":
      actor.defeated = true;
      actor.isReady = false;
      pushLog(state, { kind: "DEFEAT", actorId: actor.id, targetId: null, text: `${actor.name} 脱离了战斗` });
      return;
    case "ITEM": {
      const status = submission.status;
      if (status === undefined) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId, text: `${actor.name} 使用了道具` });
        return;
      }
      applyStatus(ctx.pack, state, targetId ?? actor.id, status.key, status.stacks);
      return;
    }
    case "SPELLCARD":
      resolveSpellcard(ctx, actor, submission);
      return;
    case "DEFEND":
    case "DODGE":
    case "COUNTER":
      pushLog(state, {
        kind: "ACTION",
        actorId: actor.id,
        targetId: null,
        text: `${actor.name} 保持 ${submission.kind} 姿态`
      });
      return;
    case "DANMAKU": {
      if (targetId === null) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: `${actor.name} 的弹幕没有目标` });
        return;
      }
      const defender = findParticipant(state, targetId);
      if (defender === undefined || defender.defeated) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId, text: `${actor.name} 的目标已不在场` });
        return;
      }
      resolveAttack(ctx, actor, submission, defender);
      return;
    }
  }
}

/** 一方全灭（或只剩单一阵营）即结束。 */
export function checkEnd(state: CombatState): boolean {
  const alive = state.participants.filter((participant) => participant.defeated === false);
  if (alive.length === 0) return true;
  const factions = new Set(alive.map((participant) => participant.faction));
  return factions.size <= 1;
}

export function endCombat(state: CombatState, reason: string): void {
  state.phase = "ENDED";
  pushLog(state, { kind: "SYSTEM", actorId: null, targetId: null, text: reason });
}

/**
 * 结算本轮所有已提交的行动。
 *
 * 顺序：按 ATB 超出量降序（速度快者先手）。
 * 防守方的选择通过 reactions 传入 —— 它是「反应」而不是「行动」，
 * 不占用 ATB 进度，只消耗灵力。
 */
export function resolvePending(
  pack: CompiledRulePack,
  state: CombatState,
  reactions: Readonly<Record<string, DefenseReaction>> = {}
): ResolveResult {
  if (state.phase === "ENDED") {
    return { acted: [], defeated: [], cleared: [] };
  }

  const order = readyParticipants(state).sort((a, b) => b.atbValue - a.atbValue);
  const submissions = { ...state.pending };
  const queue: ActionSubmission[] = [];
  for (const participant of order) {
    const submission = submissions[participant.id];
    if (submission !== undefined) queue.push(submission);
  }

  const ctx: ResolveContext = { pack, state, reactions, queue, cancelled: new Set<string>() };
  state.pending = {};

  const acted: string[] = [];
  while (ctx.queue.length > 0) {
    const submission = ctx.queue.shift() as ActionSubmission;
    const actor = findParticipant(state, submission.actorId);
    if (actor === undefined || actor.defeated) continue;
    if (ctx.cancelled.has(submission.actorId)) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: `${actor.name} 的弹幕被清除`
      });
      continue;
    }
    acted.push(actor.id);
    resolveOne(ctx, actor, submission);
  }

  for (const participant of order) {
    if (participant.defeated) continue;
    const submission = submissions[participant.id];
    const kind = submission?.kind ?? "PASS";
    const costKind = kind === "OUT_OF_RULE" ? "SPELLCARD" : kind;
    const cost = submission?.atbCost ?? resolveActionCost(pack, costKind, participant.vars);
    consumeAction(participant, cost);
  }

  state.round += 1;
  state.phase = checkEnd(state) ? "ENDED" : "ATB_CHARGING";

  return {
    acted,
    defeated: state.participants.filter((participant) => participant.defeated).map((p) => p.id),
    cleared: [...ctx.cancelled]
  };
}

/** INITIATIVE 模式：按配置的排序依据排定出手顺序。 */
export function buildInitiativeOrder(
  pack: CompiledRulePack,
  state: CombatState
): string[] {
  const alive = state.participants.filter((item) => item.defeated === false);
  const keyExpr = pack.combat.initiativeKey;
  const scored = alive.map((item) => {
    let score = item.attributes.dex;
    if (keyExpr !== null) {
      try {
        score = evaluate(keyExpr, { vars: item.vars, consts: pack.pack.const });
      } catch {
        score = item.attributes.dex;
      }
    }
    return { id: item.id, score };
  });
  // RANDOM 的随机键必须预生成，不能塞进排序比较器（比较器会被调用多次且顺序不定）
  const tieKeys = new Map<string, number>();
  if (pack.combat.tieBreak === 'RANDOM') {
    const rng = nextRollRng(state, 'initiative');
    for (const item of scored) tieKeys.set(item.id, rng.nextUint32());
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = tieKeys.get(a.id) ?? 0;
    const rb = tieKeys.get(b.id) ?? 0;
    if (ra !== rb) return rb - ra;
    return a.id < b.id ? -1 : 1;
  });
  return scored.map((item) => item.id);
}

export function currentActorId(state: CombatState): string | null {
  return state.initiativeOrder[state.activeIndex] ?? null;
}


/** 顺序制没有进度条，用 isReady 表示「轮到你了」。 */
function syncInitiativeReady(state: CombatState): void {
  const current = currentActorId(state);
  for (const participant of state.participants) {
    participant.isReady = participant.id === current && participant.defeated === false;
  }
}

/** 开一轮：重排顺序、把指针归零。 */
export function beginInitiativeRound(pack: CompiledRulePack, state: CombatState): void {
  state.initiativeOrder = buildInitiativeOrder(pack, state);
  state.activeIndex = 0;
  state.phase = checkEnd(state) ? 'ENDED' : 'AWAITING_ACTION';
  syncInitiativeReady(state);
}

/** KP 手动调序。规则包没开放这个权限时直接拒绝。 */
export function setInitiativeOrder(
  pack: CompiledRulePack,
  state: CombatState,
  order: readonly string[]
): boolean {
  if (pack.combat.kpAdjustsOrder === false) return false;
  const known = new Set(state.initiativeOrder);
  if (order.length !== known.size) return false;
  for (const id of order) {
    if (known.has(id) === false) return false;
  }
  state.initiativeOrder = [...order];
  return true;
}

/** 结束当前行动。一轮走完则重排并进入下一轮。 */
export function endTurn(
  pack: CompiledRulePack,
  state: CombatState
): { roundAdvanced: boolean; nextActorId: string | null } {
  const alive = new Set(
    state.participants.filter((item) => item.defeated === false).map((item) => item.id)
  );
  // 本轮中途倒地的人从顺序里剔除
  state.initiativeOrder = state.initiativeOrder.filter((id) => alive.has(id));
  state.activeIndex += 1;
  if (state.activeIndex >= state.initiativeOrder.length) {
    state.initiativeOrder = buildInitiativeOrder(pack, state);
    state.activeIndex = 0;
    state.round += 1;
    state.phase = checkEnd(state) ? 'ENDED' : 'AWAITING_ACTION';
    syncInitiativeReady(state);
    return { roundAdvanced: true, nextActorId: currentActorId(state) };
  }
  state.phase = 'AWAITING_ACTION';
  syncInitiativeReady(state);
  return { roundAdvanced: false, nextActorId: currentActorId(state) };
}

/**
 * INITIATIVE 模式：只结算当前轮到的那个人的行动，然后交棒。
 * 与 resolvePending 的区别是不会一次结算所有人。
 */
export function resolveInitiativeTurn(
  pack: CompiledRulePack,
  state: CombatState,
  reactions: Readonly<Record<string, DefenseReaction>> = {}
): ResolveResult {
  if (state.phase === 'ENDED') return { acted: [], defeated: [], cleared: [] };
  const actorId = currentActorId(state);
  if (actorId === null) return { acted: [], defeated: [], cleared: [] };
  const actor = findParticipant(state, actorId);
  const submission = state.pending[actorId];
  const ctx: ResolveContext = {
    pack,
    state,
    reactions,
    queue: submission === undefined ? [] : [submission],
    cancelled: new Set<string>()
  };
  delete state.pending[actorId];
  const acted: string[] = [];
  while (ctx.queue.length > 0) {
    const next = ctx.queue.shift() as ActionSubmission;
    const who = findParticipant(state, next.actorId);
    if (who === undefined || who.defeated) continue;
    if (ctx.cancelled.has(next.actorId)) {
      pushLog(state, {
        kind: 'SYSTEM',
        actorId: who.id,
        targetId: null,
        text: who.name + ' 的弹幕被清除'
      });
      continue;
    }
    acted.push(who.id);
    resolveOne(ctx, who, next);
  }
  if (actor !== undefined && actor.defeated === false) {
    actor.isReady = false;
  }
  return {
    acted,
    defeated: state.participants.filter((item) => item.defeated).map((item) => item.id),
    cleared: [...ctx.cancelled]
  };
}
