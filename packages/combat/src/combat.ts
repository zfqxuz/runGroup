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
  isHostileSpell,
  schedule,
  speedMultiplierOf,
  spellEffectsOf,
  spellTargeting,
  type ActiveStatusEffect,
  type AttributeSet,
  type CompiledRulePack,
  type DefenseType,
  type DerivedStats,
  type MagicEffect,
  type MagicSpell
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

/** 把伤害表达式里的 `db` 替换成单位的伤害加值表达式。 */
export function expandDamageBonus(source: string, damageBonus: string): string {
  return source.replace(/\bdb\b/gi, damageBonus.length > 0 ? damageBonus : "0");
}

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
  /** 伤害表达式里 `db` 的替换值，例如 "1d4" / "-2" / "0"。 */
  readonly damageBonus?: string;
  /** 单位 1/ATB_SCALE。 */
  readonly atbMax: number;
  readonly speed: number;
  readonly isIdentified?: boolean;
  readonly isPublic?: boolean;
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
    damageBonus: init.damageBonus ?? "0",
    vars,
    statusEffects: [],
    declaration: null,
    usedSpellCards: [],
    isIdentified: init.isIdentified ?? init.kind === "PLAYER",
    isPublic: init.isPublic ?? false
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
  if (!Number.isFinite(plan.ticks)) {
    return { ticks: 0, ms: 0, readyIds: [] };
  }
  if (plan.ticks <= 0) {
    // 防御：行动消耗为 0 或 ATB 溢出时会得到「ticks=0 且无人就绪」。
    // 此时至少推进 1 tick，让溢出者进入就绪，避免永久停在 ATB_CHARGING。
    const advanced = advanceTicks(alive, 1);
    state.tick += 1;
    expireTimedEffects(pack, state, 1);
    state.phase = readyParticipants(state).length > 0 ? "AWAITING_ACTION" : "ATB_CHARGING";
    return { ticks: 1, ms: state.tickMs, readyIds: advanced.map((participant) => participant.id) };
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
    if (event && event.defaultEnabled === false) return pack.system === "COC7" ? "反击" : "消弹";
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
    text: `攻击检定：${actor.name} 使用「${skillName}」掷 1d100 = ${attackRoll}，目标值 ${target} → ${attackCheck.result}`,
    data: { rollType: "ATTACK", skill: skillName, roll: attackRoll, target, result: attackCheck.result }
  });

  if (isSuccess(attackCheck.result) === false) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: `攻击落空：${actor.name} 的 1d100 = ${attackRoll} 未通过「${skillName}」检定`,
      data: { rollType: "ATTACK", roll: attackRoll, target }
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

  const isCoc7 = ctx.pack.system === "COC7";
  const counterLabel = isCoc7 ? "反击" : "消弹对抗";
  if (reaction.type === "DODGE") {
    const dodgeTarget = skillValueOf(defender, reaction.skill ?? "DODGE", defender.attributes.dex);
    const dodgeRoll = rollDie(rng, 100);
    const dodgeCheck = resolveCheck(ctx.pack, dodgeRoll, dodgeTarget);
    defenseSuccess = isSuccess(dodgeCheck.result);
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text: `${isCoc7 ? "闪避" : "擦弹"}检定：${defender.name} 掷 1d100 = ${dodgeRoll}，目标值 ${dodgeTarget} → ${dodgeCheck.result}`,
      data: { rollType: "DODGE", roll: dodgeRoll, target: dodgeTarget, result: dodgeCheck.result }
    });
  } else if (reaction.type === "COUNTER") {
    const counterTarget = skillValueOf(
      defender,
      reaction.skill ?? (isCoc7 ? "FIGHTING_BRAWL" : "DANMAKU"),
      defender.attributes.dex
    );
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
      text: `${counterLabel}对抗：攻击方 ${attackRoll}/${target} vs ${defender.name} ${counterRoll}/${counterTarget} → ${defender.name}${defenseSuccess ? "成功" : "失败"}`,
      data: { rollType: "COUNTER", attackRoll, attackTarget: target, counterRoll, counterTarget, success: defenseSuccess }
    });
  }

  const damageSource = expandDamageBonus(submission.damage ?? "0", actor.damageBonus);
  const damageRng = nextRollRng(state, `damage:${actor.id}:${defender.id}`);
  const damageRoll = rollDice(parseDice(damageSource), damageRng);
  const detailText = damageRoll.details
    .map((detail) => (detail.sign < 0 ? "-" : "+") + detail.count + "d" + detail.sides + "[" + detail.values.join(", ") + "]")
    .join("  ");
  pushLog(state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: defender.id,
    text: `伤害骰：${actor.name} 的「${damageSource}」= ${damageRoll.total}（${detailText}），范围 ${damageRoll.min}~${damageRoll.max}`,
    data: { rollType: "DAMAGE_ROLL", expression: damageSource, roll: damageRoll.total, min: damageRoll.min, max: damageRoll.max }
  });

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
  const defenseText =
    reaction.type === "PASS"
      ? "未应对"
      : (reaction.type === "DODGE" ? "闪避" : reaction.type === "COUNTER" ? counterLabel : "防御") +
        (defenseSuccess ? "成功" : "失败");

  pushLog(state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: defender.id,
    text: `伤害结算：${actor.name} → ${defender.name}，应对=${defenseText}，原始 ${damageRoll.total} → 最终 ${outcome.damage}${outcome.steps.length === 0 ? "" : "（" + outcome.steps.join("；") + "）"}`,
    data: {
      rollType: "DAMAGE_SETTLE",
      rawDamage: damageRoll.total,
      damage: outcome.damage,
      defense: reaction.type,
      defenseSuccess,
      steps: outcome.steps.join("；"),
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

function evaluateEffectNumber(pack: CompiledRulePack, source: string, vars: Record<string, number>): number {
  try {
    return Math.max(0, Math.floor(evaluateSource(pack, source, vars)));
  } catch {
    return 0;
  }
}

function rollEffectDice(source: string, state: CombatState, salt: string): number {
  try {
    return Math.max(0, rollDice(parseDice(source), nextRollRng(state, salt)).total);
  } catch {
    return 0;
  }
}

function addOrReplaceStatus(
  target: CombatParticipantState,
  status: ActiveStatusEffect
): void {
  const index = target.statusEffects.findIndex((effect) => effect.key === status.key);
  if (index < 0) {
    target.statusEffects = [...target.statusEffects, status];
    return;
  }
  target.statusEffects = target.statusEffects.map((effect, effectIndex) =>
    effectIndex === index ? { ...status, stacks: effect.stacks + status.stacks } : effect
  );
}

/** 回合开始时结算 DOT：只在目标真正进入行动时触发一次。 */
function applyStartOfTurnEffects(
  ctx: ResolveContext,
  target: CombatParticipantState
): void {
  if (target.defeated) return;
  const triggered: ActiveStatusEffect[] = [];
  const next: ActiveStatusEffect[] = [];
  for (const effect of target.statusEffects) {
    if ((effect.dotDamage ?? 0) <= 0) {
      next.push(effect);
      continue;
    }
    if (effect.dotLastTick === ctx.state.tick) {
      next.push(effect);
      continue;
    }
    triggered.push({ ...effect, dotLastTick: ctx.state.tick });
    if (effect.dotTurns !== undefined) {
      const remaining = effect.dotTurns - 1;
      if (remaining > 0) next.push({ ...effect, dotTurns: remaining, dotLastTick: ctx.state.tick });
    } else {
      next.push({ ...effect, dotLastTick: ctx.state.tick });
    }
  }
  if (triggered.length === 0) return;
  target.statusEffects = next;

  for (const effect of triggered) {
    const damage = Math.max(0, effect.dotDamage ?? 0);
    if (damage <= 0) continue;
    const applied = applyDamageToParticipant(ctx, target, damage);
    pushLog(ctx.state, {
      kind: "DAMAGE",
      actorId: target.id,
      targetId: target.id,
      text: target.name + " 受到「" + (effect.dotSource ?? effect.key) + "」持续伤害 " + damage,
      data: { dot: true, key: effect.key, damage, toDeclaration: applied.toDeclaration, toHp: applied.toHp }
    });
  }
}

function clearStatuses(
  target: CombatParticipantState,
  keys: readonly string[]
): void {
  if (keys.length === 0) {
    target.statusEffects = target.statusEffects.filter((effect) => effect.key.startsWith("DOT:") === false);
    target.stunActions = 0;
    target.controlActions = 0;
    return;
  }
  const wanted = new Set(keys);
  target.statusEffects = target.statusEffects.filter((effect) => wanted.has(effect.key) === false);
  if (wanted.has("STUN")) target.stunActions = 0;
  if (wanted.has("CONTROL")) target.controlActions = 0;
}

function resolveMagicTargets(
  state: CombatState,
  actor: CombatParticipantState,
  spell: MagicSpell,
  requestedTargetId: string | null
): CombatParticipantState[] {
  const targeting = spellTargeting(spell);
  const alive = state.participants.filter((participant) => participant.defeated === false);
  if (targeting === "SELF" || spell.target === "SELF") return [actor];
  if (spell.target === "ALL") {
    if (targeting === "ENEMY") return alive.filter((participant) => participant.faction !== actor.faction);
    if (targeting === "ALLY") return alive.filter((participant) => participant.faction === actor.faction);
    return alive;
  }
  if (requestedTargetId === null) return [];
  const target = findParticipant(state, requestedTargetId);
  return target === undefined || target.defeated ? [] : [target];
}

/**
 * 计算一个行动需要哪些单位进入「应对窗口」。
 * - 普通攻击：单个目标；
 * - 敌对法术：单体目标；群体法术（target=ALL）返回全部命中目标，保证 AOE 每个人都要应对。
 */
export function reactionTargetIdsForAction(
  pack: CompiledRulePack,
  state: CombatState,
  action: ActionSubmission
): string[] {
  const actor = findParticipant(state, action.actorId);
  if (actor === undefined || actor.defeated) return [];
  const requestedTargetId = action.targetId ?? null;

  if (action.kind === "DANMAKU") {
    if (requestedTargetId === null || requestedTargetId === actor.id) return [];
    const target = findParticipant(state, requestedTargetId);
    return target === undefined || target.defeated ? [] : [target.id];
  }

  if (action.kind === "MAGIC") {
    const rules = pack.pack.magic;
    if (rules === undefined || rules.enabled === false) return [];
    const spell = rules.spells.find(
      (item) => item.id === action.spellId || item.name === action.name
    );
    if (spell === undefined || isHostileSpell(spell) === false) return [];
    const targeting = spellTargeting(spell);
    if (targeting === "ALLY" || targeting === "SELF") return [];
    return resolveMagicTargets(state, actor, spell, requestedTargetId)
      .filter((target) => target.id !== actor.id)
      .map((target) => target.id);
  }

  return [];
}

function applyMagicEffect(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  target: CombatParticipantState,
  spell: MagicSpell,
  effect: MagicEffect,
  defense: { readonly type: DefenseType; readonly success: boolean }
): void {
  const state = ctx.state;
  const meta = { spellId: spell.id, spell: spell.name };
  const log = (text: string, data: Record<string, unknown> = {}): void => {
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: target.id,
      text,
      data: { ...meta, ...data }
    });
  };

  if (effect.type === "DAMAGE") {
    const base = rollEffectDice(effect.amount, state, "magic-damage:" + actor.id + ":" + spell.id + ":" + target.id);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: target.id,
      text: "伤害骰：「" + spell.name + "」对 " + target.name + " 的 " + effect.amount + " = " + base,
      data: { ...meta, rollType: "DAMAGE_ROLL", expression: effect.amount, roll: base }
    });
    const shieldMultiplier = damageMultiplierOf(ctx.pack, target.statusEffects, target.vars);
    const outcome = applyDamagePipeline(ctx.pack, {
      baseDamage: base,
      defense: defense.type,
      defenseSuccess: defense.success,
      shieldMultiplier,
      vars: target.vars
    });
    if (outcome.mpCost > 0) target.mp = Math.max(0, target.mp - outcome.mpCost);
    if (outcome.mpGained > 0) target.mp = Math.min(target.maxMp, target.mp + outcome.mpGained);
    const applied = applyDamageToParticipant(ctx, target, outcome.damage);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: target.id,
      text: "伤害结算：「" + spell.name + "」→ " + target.name + "，应对=" + defense.type + (defense.type === "PASS" ? "" : defense.success ? "成功" : "失败") + "，原始 " + base + " → 最终 " + outcome.damage + (outcome.steps.length === 0 ? "" : "（" + outcome.steps.join("；") + "）"),
      data: { ...meta, rollType: "DAMAGE_SETTLE", rawDamage: base, damage: outcome.damage, defense: defense.type, defenseSuccess: defense.success, steps: outcome.steps.join("；"), toDeclaration: applied.toDeclaration, toHp: applied.toHp }
    });
    return;
  }

  if (effect.type === "HEAL") {
    const amount = rollEffectDice(effect.amount, state, "magic-heal:" + actor.id + ":" + spell.id + ":" + target.id);
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 恢复 " + (target.hp - before) + " HP", { heal: target.hp - before });
    return;
  }

  if (effect.type === "MP_RESTORE") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const before = target.mp;
    target.mp = Math.min(target.maxMp, target.mp + amount);
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 恢复 " + (target.mp - before) + " MP", { mp: target.mp - before });
    return;
  }

  if (effect.type === "MP_DRAIN") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const drained = Math.min(target.mp, amount);
    target.mp -= drained;
    actor.mp = Math.min(actor.maxMp, actor.mp + drained);
    log(actor.name + " 施放「" + spell.name + "」 → 抽取 " + target.name + " " + drained + " MP", { drained });
    return;
  }

  if (effect.type === "SAN_LOSS") {
    const amount = rollEffectDice(effect.amount, state, "magic-san-loss:" + actor.id + ":" + spell.id + ":" + target.id);
    const before = target.san;
    target.san = Math.max(0, target.san - amount);
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 失去 " + (before - target.san) + " SAN", { sanLoss: before - target.san });
    return;
  }

  if (effect.type === "SAN_RESTORE") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const before = target.san;
    target.san = Math.min(target.maxSan, target.san + amount);
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 恢复 " + (target.san - before) + " SAN", { sanGain: target.san - before });
    return;
  }

  if (effect.type === "STATUS") {
    const stacks = Math.max(1, evaluateEffectNumber(ctx.pack, effect.stacks, actor.vars));
    applyStatus(ctx.pack, state, target.id, effect.key, stacks);
    return;
  }

  if (effect.type === "DOT") {
    const amount = rollEffectDice(effect.amount, state, "magic-dot:" + actor.id + ":" + spell.id + ":" + target.id);
    const duration = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationTicks, actor.vars));
    const key = effect.key ?? ("DOT:" + spell.id);
    addOrReplaceStatus(target, {
      key,
      stacks: 1,
      remainingTicks: Number.MAX_SAFE_INTEGER,
      dotTurns: duration,
      dotDamage: amount,
      dotSource: spell.name,
      dotLastTick: -1
    });
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 获得持续伤害 " + amount + "（" + duration + " tick）", { dot: amount, duration });
    return;
  }

  if (effect.type === "STUN") {
    const actions = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationActions, actor.vars));
    target.stunActions = Math.max(target.stunActions ?? 0, actions);
    target.atbValue = 0;
    target.isReady = false;
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 眩晕，跳过 " + actions + " 次行动", { stunActions: actions });
    return;
  }

  if (effect.type === "CONTROL") {
    const actions = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationActions, actor.vars));
    target.controlActions = Math.max(target.controlActions ?? 0, actions);
    log(actor.name + " 施放「" + spell.name + "」 → " + target.name + " 被控制，跳过 " + actions + " 次行动", { controlActions: actions });
    return;
  }

  if (effect.type === "CLEANSE") {
    clearStatuses(target, effect.keys);
    log(actor.name + " 施放「" + spell.name + "」 → 净化 " + target.name + " 的 " + (effect.keys.length === 0 ? "持续伤害 / 控制" : effect.keys.join("、")), { cleanse: true });
  }
}

/** 眩晕 / 控制的单位进入行动位时强制跳过。 */
export function applyForcedSkips(state: CombatState): void {
  for (const participant of state.participants) {
    if (participant.defeated || participant.isReady === false) continue;
    const stun = participant.stunActions ?? 0;
    const control = participant.controlActions ?? 0;
    if (stun + control <= 0) continue;
    if (state.pending[participant.id] !== undefined) continue;
    if (stun > 0) participant.stunActions = stun - 1;
    else participant.controlActions = control - 1;
    state.pending[participant.id] = { actorId: participant.id, kind: "PASS" };
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: null,
      text: participant.name + " 因" + (stun > 0 ? "眩晕" : "控制") + "跳过行动"
    });
  }
}

function resolveMagic(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const rules = ctx.pack.pack.magic;
  if (rules === undefined || rules.enabled === false) {
    pushLog(state, { kind: "SYSTEM", actorId: actor.id, targetId: null, text: "本规则包未启用魔法规则" });
    return;
  }
  const spell = rules.spells.find((item) => item.id === submission.spellId || item.name === submission.name);
  if (spell === undefined) {
    pushLog(state, { kind: "SYSTEM", actorId: actor.id, targetId: null, text: "没有找到这个法术" });
    return;
  }

  const mpCost = Math.max(0, Math.floor(evaluateSource(ctx.pack, spell.mpCost, actor.vars)));
  let sanCost = 0;
  try {
    sanCost = Math.max(
      0,
      rollDice(parseDice(spell.sanCost), nextRollRng(state, "magic-san:" + actor.id + ":" + spell.id)).total
    );
  } catch {
    sanCost = 0;
  }
  actor.mp = Math.max(0, actor.mp - mpCost);
  actor.san = Math.max(0, actor.san - sanCost);

  const requestedTargetId = submission.targetId ?? null;
  const targets = resolveMagicTargets(state, actor, spell, requestedTargetId);
  if (targets.length === 0) {
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: requestedTargetId,
      text: actor.name + " 施放「" + spell.name + "」，但目标已不在场，消耗 MP " + mpCost + " / SAN " + sanCost,
      data: { spellId: spell.id, spell: spell.name, mpCost, sanCost }
    });
    return;
  }

  const effects = spellEffectsOf(spell);
  const targeting = spellTargeting(spell);
  for (const target of targets) {
    let defense: { type: DefenseType; success: boolean } = { type: "PASS", success: false };
    const reaction = reactionFor(ctx, target.id);
    const blocked = disabledReactionFor(ctx.pack, reaction.type);
    const effectiveReaction = blocked === null ? reaction : { type: "PASS" as DefenseType };

    if (target.id !== actor.id && effectiveReaction.type === "DODGE" && targeting !== "ALLY" && targeting !== "SELF") {
      const dodgeTarget = skillValueOf(target, effectiveReaction.skill ?? "DODGE", target.attributes.dex);
      const dodgeRoll = rollDie(nextRollRng(state, "magic-dodge:" + actor.id + ":" + target.id), 100);
      const dodgeCheck = resolveCheck(ctx.pack, dodgeRoll, dodgeTarget);
      pushLog(state, {
        kind: "CHECK",
        actorId: target.id,
        targetId: actor.id,
        text: target.name + " 应对「" + spell.name + "」闪避判定 " + dodgeRoll + "/" + dodgeTarget + " → " + dodgeCheck.result,
        data: { roll: dodgeRoll, target: dodgeTarget, result: dodgeCheck.result }
      });
      if (isSuccess(dodgeCheck.result)) {
        pushLog(state, {
          kind: "SPELLCARD",
          actorId: actor.id,
          targetId: target.id,
          text: target.name + " 成功避开了「" + spell.name + "」",
          data: { spellId: spell.id, spell: spell.name, evaded: true, mpCost, sanCost }
        });
        continue;
      }
      defense = { type: "DODGE", success: false };
    } else if (target.id !== actor.id && effectiveReaction.type === "DEFEND") {
      defense = { type: "DEFEND", success: true };
    }

    if (effects.length === 0) {
      pushLog(state, {
        kind: "SPELLCARD",
        actorId: actor.id,
        targetId: target.id,
        text: actor.name + " 施放「" + spell.name + "」 → " + target.name + "（无直接效果）",
        data: { spellId: spell.id, spell: spell.name, mpCost, sanCost }
      });
      continue;
    }

    for (const effect of effects) {
      if (target.defeated) break;
      applyMagicEffect(ctx, actor, target, spell, effect, defense);
    }
  }
}

function resolveOne(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const targetId = submission.targetId ?? null;

  switch (submission.kind) {
    case "MAGIC":
      resolveMagic(ctx, actor, submission);
      return;
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

  for (const participant of order) applyStartOfTurnEffects(ctx, participant);

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
    const costKind = kind === "OUT_OF_RULE" || kind === "MAGIC" ? "SPELLCARD" : kind;
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
  if (actor === undefined) return { acted: [], defeated: [], cleared: [] };
  const submission = state.pending[actorId];
  const ctx: ResolveContext = {
    pack,
    state,
    reactions,
    queue: submission === undefined ? [] : [submission],
    cancelled: new Set<string>()
  };
  applyStartOfTurnEffects(ctx, actor);
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
