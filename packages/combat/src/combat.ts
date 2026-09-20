import {
  diceBounds,
  evaluate,
  compile as compileExpr,
  parseDice,
  rollDice,
  rollDie,
  rollPercentile,
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
  coc7Build,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  damageMultiplierOf,
  fromMicro,
  isHostileSpell,
  schedule,
  spendMagicPoints,
  speedMultiplierOf,
  spellEffectsOf,
  spellTargeting,
  clampTouhouDpDice,
  resolveAbilityCategory,
  touhouChaseDamage,
  touhouLscRecoveryDue,
  touhouMeleeDamage,
  touhouRangedDamage,
  touhouResistTargetValue,
  type ActiveStatusEffect,
  type AttributeSet,
  type CheckOutcome,
  type CompiledRaceAbility,
  type CompiledRulePack,
  type DefenseType,
  type DerivedStats,
  type MagicEffect,
  type MagicSpell
} from "@touhou/rules";
import { rngFor } from "./rng";
import { loadParticipantConditions, possessInitFromConditions } from "./conditions";
import type {
  ActionSubmission,
  CombatMode,
  CombatParticipantState,
  CombatPassiveMods,
  CombatState,
  LogEntry,
  SummonTemplate
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
    dp: (init.mode ?? 'ATB') === 'DP' ? { declared: {}, regenBonus: {}, acted: [] } : null,
    spellcardBattle: null,
    initiativeOrder: [],
    activeIndex: 0,
    tick: 0,
    round: 1,
    phase: "ATB_CHARGING",
    seq: 0,
    rollSeq: 0,
    summonSeq: 0,
    participants: [],
    pending: {},
    log: [],
    chase: null
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
  /** 规则包中的种族 key；COC7 / 无种族单位省略。 */
  readonly race?: string | null;
  /** 种族扁平 flags；通常由 computeDerived 提供。 */
  readonly raceFlags?: readonly string[];
  /** 先天 / 装备元素亲和与抗性（元素 id 列表）。 */
  readonly elements?: readonly string[];
  /** 千幻抄能力等级：categoryId -> Lv。 */
  readonly abilityLevels?: Readonly<Record<string, number>>;
  /** 能力实例的发动特性值覆盖，例如 { "ELEMENTALIST:FIRE": "dex" }。 */
  readonly abilityAttributes?: Readonly<Record<string, string>>;
  /** 常时被动加值；由规则层在战斗准备阶段算出。 */
  readonly passiveMods?: CombatPassiveMods;
  readonly skills?: Record<string, number>;
  /** 该单位允许施放的法术 id。 */
  readonly spells?: readonly string[];
  /** 伤害表达式里 `db` 的替换值，例如 "1d4" / "-2" / "0"。 */
  readonly damageBonus?: string;
  /** 单位 1/ATB_SCALE。 */
  readonly atbMax: number;
  readonly speed: number;
  readonly isIdentified?: boolean;
  readonly isPublic?: boolean;
  /** 初始护甲；由 NPC 卡 / 预施法护甲提供。 */
  readonly armor?: number;
  /** 召唤来源：由哪个参战单位召唤入场。 */
  readonly summonedBy?: string | null;
  readonly summonedName?: string | null;
  readonly armorExpiresAtRound?: number | null;
  readonly summonExpiresAtRound?: number | null;
  readonly possessedBy?: string | null;
  /** 夺舍充能池剩余量。 */
  readonly possessCharges?: number;
  /** 局内持久状态（从 GameCharacter / Card 读入）。 */
  readonly conditions?: unknown;
  /**
   * 从 GameCharacter / Card 带入的当前数值；缺省时使用 derived 最大值。
   * 用于「带伤 / 消耗进入新战斗」，不能再用满血初始化。
   */
  readonly vitals?: {
    readonly hp?: number;
    readonly mp?: number;
    readonly san?: number;
    readonly dp?: number;
  };
}

function initVital(value: number | undefined, max: number): number {
  if (value === undefined || Number.isFinite(value) === false) return max;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

export function addParticipant(
  state: CombatState,
  init: ParticipantInit
): CombatParticipantState {
  const vars: Record<string, number> = {};
  for (const [key, value] of Object.entries(init.attributes)) vars[key] = value;
  for (const [key, value] of Object.entries(init.derived)) vars[key] = value;
  vars.atbMax = fromMicro(init.atbMax);

  const loadedConditions = loadParticipantConditions(init.conditions);
  const initPossess = possessInitFromConditions(loadedConditions);
  const armorCondition = loadedConditions.find((condition) => condition.type === "ARMOR");
  const conditionArmor =
    armorCondition !== undefined && typeof armorCondition.data.armor === "number"
      ? Math.max(0, Math.floor(armorCondition.data.armor))
      : 0;
  const hasCondition = (type: string): boolean => loadedConditions.some((condition) => condition.type === type);
  const maxHp = Math.max(0, Math.floor(init.derived.maxHp));
  const maxMp = Math.max(0, Math.floor(init.derived.maxMp));
  const maxSan = Math.max(0, Math.floor(init.derived.maxSan));
  const maxDp = Math.max(0, Math.floor(init.derived.maxDp));
  const dead = hasCondition("DEAD");
  const hp = dead ? 0 : initVital(init.vitals?.hp, maxHp);
  const mp = initVital(init.vitals?.mp, maxMp);
  const san = initVital(init.vitals?.san, maxSan);
  const dp = initVital(init.vitals?.dp, maxDp);
  const hpZero = hp <= 0;
  const majorWound = hasCondition("MAJOR_WOUND");
  const prone = hasCondition("PRONE") || hpZero;
  const unconscious = hasCondition("UNCONSCIOUS") || hpZero;
  const dying = hasCondition("DYING");
  const defeated = dead || dying || unconscious;
  vars.hp = hp;
  vars.maxHp = maxHp;
  vars.mp = mp;
  vars.maxMp = maxMp;
  vars.san = san;
  vars.maxSan = maxSan;
  vars.dp = dp;
  vars.maxDp = maxDp;
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
    defeated,
    majorWound,
    prone,
    unconscious,
    dying,
    dead,
    dyingSinceRound: 0,
    hp,
    maxHp,
    mp,
    maxMp,
    san,
    maxSan,
    dp,
    maxDp,
    grazePoints: 0,
    armor: Math.max(0, Math.floor(init.armor ?? conditionArmor)),
    maxArmor: Math.max(0, Math.floor(init.armor ?? conditionArmor)),
    summonedBy: init.summonedBy ?? null,
    summonedName: init.summonedName ?? null,
    armorExpiresAtRound:
      init.armorExpiresAtRound ??
      (armorCondition !== undefined && armorCondition.duration.unit === "ROUND" && armorCondition.duration.remaining > 0
        ? state.round + armorCondition.duration.remaining
        : null),
    summonExpiresAtRound: init.summonExpiresAtRound ?? null,
    possessedBy: init.possessedBy ?? initPossess.possessedBy,
    possessCharges: Math.max(0, Math.floor(init.possessCharges ?? initPossess.possessCharges)),
    conditions: loadedConditions,
    attributes: init.attributes,
    derived: init.derived,
    race: init.race ?? null,
    raceFlags: [...(init.raceFlags ?? [])],
    elements: [...(init.elements ?? [])],
    abilityLevels: { ...(init.abilityLevels ?? {}) },
    barrier: null,
    abilityAttributes: { ...(init.abilityAttributes ?? {}) },
    passiveMods: {
      damageBonus: init.passiveMods?.damageBonus ?? 0,
      reactionBonus: init.passiveMods?.reactionBonus ?? 0,
      accuracyBonus: init.passiveMods?.accuracyBonus ?? 0,
      movementBonus: init.passiveMods?.movementBonus ?? 0
    },
    mpExhausted: false,
    skills: init.skills ?? {},
    spells: [...(init.spells ?? [])],
    damageBonus: init.damageBonus ?? "0",
    vars,
    statusEffects: [],
    declaration: null,
    usedSpellCards: [],
    isIdentified: init.isIdentified ?? init.kind === "PLAYER",
    isPublic: init.isPublic ?? false,
    skipNextAction: 0,
    reactionsThisRound: 0,
    initiativeMod: 0,
    grappledBy: null,
    disarmed: false
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
  if (participant === undefined) return;
  const rule = pack.statusEffects[key];
  if (rule === undefined) {
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: participant.id,
      text: participant.name + " 尝试获得状态 " + key + "，但规则包未定义该状态",
      data: { key, missingStatusRule: true }
    });
    return;
  }
  if (participant.defeated) return;

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
        text: `${participant.name} 的符卡「${declaration.name}」持续时间结束`,
        data: { event: "EXPIRE", name: declaration.name, cardId: declaration.cardId }
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
  /** DP 模式防御行动消费的骰数。 */
  readonly dpDice?: number;
  /** DP 掩护 / 身代：本次掩护的队友 id。 */
  readonly coverTargetId?: string;
  /** COC7 反击成功时反击者对攻击者使用的武器伤害表达式（由服务端按装备解析）。 */
  readonly damage?: string;
  readonly weaponName?: string;
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
  /** 同一动作内多次攻击共享掩体检定结果，避免每发重新掷骰。 */
  readonly coverCache?: Map<string, { readonly penaltyDice: number; readonly forfeited: boolean }>;
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

/** 千幻抄 4.11：击破展开型 SC 的一方，按自己的 DP 自然回复量回复 DP。 */
function grantDeclarationBreakerDp(
  ctx: ResolveContext,
  breaker: CombatParticipantState,
  owner: CombatParticipantState,
  declarationName: string
): void {
  const dpRules = ctx.pack.pack.dp;
  if (dpRules === undefined || breaker.id === owner.id || breaker.defeated) return;
  let regen = Math.max(0, Math.floor(dpRules.minRegen));
  try {
    regen = Math.max(regen, Math.floor(evaluateSource(ctx.pack, dpRules.regen, breaker.vars)));
  } catch {
    // 表达式失败时退回 minRegen。
  }
  if (regen <= 0) return;
  const before = Math.max(0, Math.floor(breaker.dp));
  breaker.dp = Math.min(breaker.maxDp, before + regen);
  const gained = breaker.dp - before;
  if (gained <= 0) return;
  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: breaker.id,
    targetId: owner.id,
    text: breaker.name + " 击破「" + declarationName + "」，回复 " + gained + " DP（" + breaker.dp + " / " + breaker.maxDp + "）",
    data: { rollType: "SPELLCARD_BREAK_DP_RECOVER", name: declarationName, gained, dp: breaker.dp }
  });
}

/** 千幻抄 4.11：主动放弃展开中的 SC 时，由敌对阵营一人回复 DP 自然回复量。 */
function abandonSpellcard(ctx: ResolveContext, actor: CombatParticipantState): void {
  const declaration = actor.declaration;
  if (declaration === null) {
    pushLog(ctx.state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 没有展开中的符卡可以放弃"
    });
    return;
  }
  actor.declaration = null;
  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: actor.id,
    targetId: null,
    text: actor.name + " 主动放弃了符卡「" + declaration.name + "」",
    data: { rollType: "SPELLCARD_ABANDONED", name: declaration.name, cardId: declaration.cardId }
  });
  const enemy = ctx.state.participants.find(
    (participant) => participant.defeated === false && participant.faction !== actor.faction
  );
  if (enemy !== undefined) {
    grantDeclarationBreakerDp(ctx, enemy, actor, declaration.name);
  }
}

/**
 * 千幻抄 4.15：LSC 被击破 30 分钟后，DP 初始值与上限恢复。
 * 由回合开始 / 战斗恢复时调用；气绝状态不自动解除。
 */
export function recoverTouhouLscLimits(
  pack: CompiledRulePack,
  state: CombatState,
  nowMs: number = Date.now()
): string[] {
  if (pack.system !== "TOUHOU") return [];
  const recovered: string[] = [];
  for (const participant of state.participants) {
    if (participant.lscBroken !== true) continue;
    if (touhouLscRecoveryDue(participant.lscBrokenAt, nowMs) === false) continue;
    const expression = pack.pack.derived.maxDp ?? "0";
    let maxDp = 0;
    try {
      maxDp = Math.max(0, Math.floor(evaluateSource(pack, expression, participant.vars)));
    } catch {
      maxDp = 0;
    }
    participant.maxDp = maxDp;
    participant.dp = maxDp;
    participant.lscBroken = false;
    participant.lscBrokenAt = null;
    recovered.push(participant.id);
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: null,
      text: participant.name + " 的 LSC 后遗症恢复：DP 上限回到 " + maxDp,
      data: { rollType: "LSC_DP_RECOVERED", maxDp }
    });
  }
  return recovered;
}

function breakDeclaration(
  ctx: ResolveContext,
  owner: CombatParticipantState,
  breaker?: CombatParticipantState
): void {
  const declaration = owner.declaration;
  if (declaration === null) return;
  owner.declaration = null;

  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: owner.id,
    targetId: null,
    text: `${owner.name} 的符卡「${declaration.name}」被击破`,
    data: { event: "BREAK", name: declaration.name, cardId: declaration.cardId, hp: 0 }
  });
  if (breaker !== undefined) {
    grantDeclarationBreakerDp(ctx, breaker, owner, declaration.name);
  }

  // 千幻抄 4.15：LSC 被击破立刻气绝，之后 30 分钟 DP 初始值与上限视为 0。
  if (declaration.isLsc === true) {
    owner.unconscious = true;
    owner.defeated = true;
    owner.lscBroken = true;
    owner.lscBrokenAt = new Date().toISOString();
    owner.dp = 0;
    owner.maxDp = 0;
    pushLog(ctx.state, {
      kind: "DEFEAT",
      actorId: owner.id,
      targetId: null,
      text: owner.name + " 的 LSC 被击破，立刻气绝（30 分钟内 DP 上限视为 0）",
      data: { rollType: "LSC_BROKEN", name: declaration.name }
    });
  }

  const rules = ctx.pack.pack.spellcard;
  if (rules === undefined) return;
  const clearEvent = ctx.pack.pack.combat.events.SPELLCARD_BREAK_CLEARS_DANMAKU;
  if (clearEvent && clearEvent.defaultEnabled === false) return;
  if (rules.declaration.onBreakClearDanmaku === false) return;

  const mode = declaration.clearTargets;
  for (const submission of ctx.queue) {
    if (submission.kind !== "DANMAKU") continue;
    if (mode === "OTHERS_ONLY" && submission.actorId === owner.id) continue;
    ctx.cancelled.add(submission.actorId);
  }
}

function combatEventEnabled(pack: CompiledRulePack, eventId: string): boolean {
  return pack.system === "COC7" && pack.combat.events[eventId]?.defaultEnabled === true;
}

function combatEventParam(
  pack: CompiledRulePack,
  eventId: string,
  key: string,
  vars: Readonly<Record<string, number>>,
  fallback: number
): number {
  const expression = pack.combat.events[eventId]?.params[key];
  if (expression === undefined) return fallback;
  try {
    const value = evaluate(expression, { vars, consts: pack.pack.const });
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** 从战斗里彻底移除一个参战单位（召唤物到期用）。 */
function removeParticipant(state: CombatState, id: string): void {
  const participantIndex = state.participants.findIndex((item) => item.id === id);
  if (participantIndex < 0) return;
  state.participants.splice(participantIndex, 1);
  delete state.pending[id];

  const orderIndex = state.initiativeOrder.indexOf(id);
  if (orderIndex >= 0) {
    state.initiativeOrder.splice(orderIndex, 1);
    if (state.activeIndex > orderIndex) state.activeIndex -= 1;
    if (state.initiativeOrder.length === 0) state.activeIndex = 0;
    else if (state.activeIndex >= state.initiativeOrder.length) state.activeIndex = state.initiativeOrder.length - 1;
  }

  if (state.chase !== null) {
    state.chase.participants = state.chase.participants.filter((item) => item.id !== id);
    state.chase.order = state.chase.order.filter((itemId) => itemId !== id);
  }
}

/**
 * 统一按「行动轮次」检查持续型效果：
 * - 护甲 duration 到期后清空剩余护甲；
 * - 召唤物 duration 到期后从战斗里移除。
 *
 * duration = 0 表示持续到耗尽 / 战斗结束。
 */
/**
 * D-2：回合结束时自动结算 DOT / 环境持续伤害。
 * 每层 DOT 掷一次伤害表达式，走 COC7 伤害管线（重伤 / 昏迷 / 濒死 / 死亡），并扣减 1 轮持续时间。
 */
export function resolveRoundEndDotDamage(pack: CompiledRulePack, state: CombatState): void {
  const hasDot = state.participants.some((participant) =>
    (participant.conditions ?? []).some(
      (condition) => condition.type === "DOT" && condition.duration.unit === "ROUND" && condition.duration.remaining > 0
    )
  );
  if (hasDot === false) return;
  const ctx: ResolveContext = {
    pack,
    state,
    reactions: {},
    queue: [],
    cancelled: new Set<string>(),
    coverCache: new Map()
  };
  for (const participant of [...state.participants]) {
    if (participant.defeated) continue;
    const current = participant.conditions ?? [];
    const dots = current.filter(
      (condition) => condition.type === "DOT" && condition.duration.unit === "ROUND" && condition.duration.remaining > 0
    );
    if (dots.length === 0) continue;
    let next = [...current];
    for (const dot of dots) {
      const expression =
        typeof dot.data.expression === "string" && dot.data.expression.trim().length > 0
          ? dot.data.expression
          : "1d3";
      const damageType = typeof dot.data.damageType === "string" ? dot.data.damageType : "持续伤害";
      let amount = 0;
      try {
        amount = Math.max(
          0,
          Math.floor(rollDice(parseDice(expression), nextRollRng(state, "dot:" + participant.id + ":" + state.round)).total)
        );
      } catch {
        amount = 0;
      }
      if (amount > 0) {
        const before = participant.hp;
        applyDamageToParticipant(ctx, participant, amount);
        pushLog(state, {
          kind: "DAMAGE",
          actorId: participant.id,
          targetId: participant.id,
          text:
            participant.name +
            " 受到「" +
            damageType +
            "」持续伤害 " +
            amount +
            " 点（HP " +
            before +
            " → " +
            participant.hp +
            "）",
          data: { rollType: "DOT", damageType, expression, damage: amount }
        });
      }
      const remaining = Math.max(0, Math.floor(dot.duration.remaining) - 1);
      next =
        remaining > 0
          ? next.map((condition) =>
              condition.id === dot.id ? { ...condition, duration: { ...condition.duration, remaining } } : condition
            )
          : next.filter((condition) => condition.id !== dot.id);
    }
    participant.conditions = next;
  }
}

/** 清理到期结界；到期的结界移除并写日志。 */
export function expireBarriers(state: CombatState): string[] {
  const expired: string[] = [];
  for (const participant of state.participants) {
    const barrier = participant.barrier;
    if (barrier === null || barrier === undefined) continue;
    if (barrier.expiresAtRound === null || state.round < barrier.expiresAtRound) continue;
    participant.barrier = null;
    expired.push(participant.id);
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: participant.id,
      text: participant.name + " 的「" + barrier.name + "」持续时间结束",
      data: { rollType: "BARRIER_EXPIRED", name: barrier.name }
    });
  }
  return expired;
}

function expireRoundTimers(state: CombatState): void {
  expireBarriers(state);
  for (const participant of [...state.participants]) {
    if (participant.armorExpiresAtRound !== null && participant.armorExpiresAtRound !== undefined && state.round >= participant.armorExpiresAtRound) {
      const hadArmor = participant.armor;
      participant.armor = 0;
      participant.armorExpiresAtRound = null;
      if (hadArmor > 0) {
        pushLog(state, {
          kind: "STATUS",
          actorId: participant.id,
          targetId: participant.id,
          text: participant.name + " 的护甲持续时间结束，剩余 " + hadArmor + " 点护甲消散",
          data: { armorExpired: true, armorRemaining: hadArmor }
        });
      }
    }

    if (participant.possessedBy !== null && participant.possessedBy !== undefined) {
      // 夺舍按充能池计时：每经过 1 个行动轮次消耗 1 格，耗尽后归还控制权。
      const remaining = Math.max(0, Math.floor(participant.possessCharges ?? 0)) - 1;
      participant.possessCharges = Math.max(0, remaining);
      if (remaining <= 0) {
        const possessedBy = participant.possessedBy;
        participant.possessedBy = null;
        participant.possessCharges = 0;
        pushLog(state, {
          kind: "STATUS",
          actorId: possessedBy,
          targetId: participant.id,
          text: participant.name + " 的夺舍充能耗尽，控制权归还",
          data: { possessionEnded: true, possessCharges: 0 }
        });
      }
    }

    if (participant.summonExpiresAtRound !== null && participant.summonExpiresAtRound !== undefined && state.round >= participant.summonExpiresAtRound) {
      pushLog(state, {
        kind: "SPELLCARD",
        actorId: participant.summonedBy ?? null,
        targetId: participant.id,
        text: "召唤物「" + participant.name + "」持续时间结束，退出战斗",
        data: { summonExpired: true, summonId: participant.id }
      });
      removeParticipant(state, participant.id);
    }
  }
}

/** 消耗护甲吸收伤害：每 1 点护甲抵消 1 点伤害，护甲同时扣减。 */
function absorbWithArmor(target: CombatParticipantState, amount: number): { absorbed: number; remaining: number } {
  const damage = Math.max(0, Math.floor(amount));
  const armor = Math.max(0, Math.floor(target.armor ?? 0));
  const absorbed = Math.min(armor, damage);
  if (absorbed > 0) target.armor = armor - absorbed;
  return { absorbed, remaining: damage - absorbed };
}

/**
 * COC7 MP 消耗：不足时按规则包配置转扣 HP。
 * 该函数只处理资源，不处理该行动本身的效果；返回 false 表示资源不足且规则不允许透支。
 */
function spendCombatMagicPoints(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  cost: number,
  sourceLabel: string
): boolean {
  const amount = Math.max(0, Math.floor(cost));
  if (amount <= 0) return true;

  if (ctx.pack.system !== "COC7") {
    actor.mp = Math.max(0, actor.mp - amount);
    applyTouhouMpExhaustion(ctx, actor);
    return true;
  }

  const rules = ctx.pack.pack.magicPoint;
  const spent = spendMagicPoints(actor.mp, actor.hp, amount, rules);
  if (spent.allowed === false) {
    pushLog(ctx.state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 的 MP 与 HP 不足以支付" + sourceLabel + "（需要 " + amount + " 点）"
    });
    return false;
  }

  actor.mp = spent.mpAfter;
  actor.vars.mp = actor.mp;
  if (spent.hpLoss > 0) {
    actor.hp = Math.max(0, actor.hp - spent.hpLoss);
    actor.vars.hp = actor.hp;
    pushLog(ctx.state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: actor.id,
      text:
        actor.name +
        " 的 MP 只有 " +
        spent.mpAfter +
        "，不足 " +
        spent.shortfall +
        " 点；按规则从 HP 扣除 " +
        spent.hpLoss +
        "（HP " +
        (actor.hp + spent.hpLoss) +
        "→" +
        actor.hp +
        "）",
      data: { rollType: "MP_OVERFLOW_TO_HP", shortfall: spent.shortfall, hpLoss: spent.hpLoss }
    });
    if (actor.hp <= 0) {
      actor.hp = 0;
      actor.prone = true;
      actor.unconscious = true;
      actor.defeated = true;
      actor.isReady = false;
      if (combatEventEnabled(ctx.pack, "DYING") && actor.majorWound === true) {
        actor.dying = true;
        actor.dyingSinceRound = ctx.state.round;
      }
      pushLog(ctx.state, {
        kind: "DEFEAT",
        actorId: actor.id,
        targetId: actor.id,
        text: actor.name + " 因 MP 透支失去战斗能力",
        data: { rollType: "MP_OVERFLOW_DOWN" }
      });
    }
  }
  return true;
}

/** 千幻抄 14.3：灵力归零即昏迷、行动不能。 */
function applyTouhouMpExhaustion(ctx: ResolveContext, participant: CombatParticipantState): void {
  if (ctx.pack.system !== "TOUHOU") return;
  if (participant.mp > 0 || participant.mpExhausted === true) return;
  participant.mp = 0;
  participant.mpExhausted = true;
  participant.unconscious = true;
  participant.prone = true;
  participant.defeated = true;
  participant.isReady = false;
  pushLog(ctx.state, {
    kind: "DEFEAT",
    actorId: participant.id,
    targetId: participant.id,
    text: participant.name + " 灵力归零，昏迷并失去行动能力",
    data: { rollType: "MP_EXHAUSTED" }
  });
}

/** 灵力回复到正数时解除「灵力归零昏迷」；HP 仍为 0 时不解除战斗不能。 */
function clearTouhouMpExhaustion(ctx: ResolveContext, participant: CombatParticipantState): void {
  if (ctx.pack.system !== "TOUHOU") return;
  if (participant.mpExhausted !== true || participant.mp <= 0) return;
  participant.mpExhausted = false;
  if (participant.dead === true || participant.hp <= 0) return;
  participant.unconscious = false;
  participant.prone = false;
  participant.defeated = false;
  pushLog(ctx.state, {
    kind: "STATUS",
    actorId: participant.id,
    targetId: participant.id,
    text: participant.name + " 灵力恢复，从灵力归零昏迷中苏醒",
    data: { rollType: "MP_RECOVERED" }
  });
}

/** 读取参战单位种族上的某条能力定义；没有种族 / 找不到时返回 null。 */
function raceAbilityOf(
  pack: CompiledRulePack,
  participant: CombatParticipantState,
  abilityId: string
): CompiledRaceAbility | null {
  const raceKey = participant.race;
  if (raceKey === null || raceKey === undefined) return null;
  const race = pack.races[raceKey];
  if (race === undefined) return null;
  return race.abilities.find((ability) => ability.id === abilityId) ?? null;
}

/** 求值种族能力的数值参数，失败时回退到 fallback。 */
function raceAbilityNumber(
  pack: CompiledRulePack,
  participant: CombatParticipantState,
  ability: CompiledRaceAbility,
  key: string,
  fallback: number
): number {
  const expression = ability.params[key];
  if (expression === undefined) return fallback;
  try {
    const value = evaluate(expression, { vars: participant.vars, consts: pack.pack.const });
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 计算种族弱点带来的伤害乘数。
 *
 * - 技能弱点：能力 tags 命中本次攻击技能（如妖怪对 MAGIC / SPIRIT_ARTS）。
 * - 状态弱点：目标带有 tags 指定的状态 key（如吸血鬼的 SUNLIGHT）。
 *
 * COC7 单位 race 为 null，永远返回 1。
 */
function raceIncomingMultiplier(
  pack: CompiledRulePack,
  target: CombatParticipantState,
  skillName: string | undefined
): number {
  if (pack.system !== "TOUHOU") return 1;
  const raceKey = target.race;
  if (raceKey === null || raceKey === undefined) return 1;
  const race = pack.races[raceKey];
  if (race === undefined) return 1;
  let multiplier = 1;
  for (const ability of race.abilities) {
    if (ability.automated === false) continue;
    if (
      ability.id !== "SPIRIT_WEAKNESS" &&
      ability.id !== "MAGIC_WEAKNESS" &&
      ability.id !== "SUNLIGHT_WEAKNESS"
    ) {
      continue;
    }
    const skillMatch = skillName !== undefined && ability.tags.includes(skillName);
    const statusMatch = ability.tags.some((tag) =>
      target.statusEffects.some(
        (effect) => effect.key === tag || effect.key.startsWith(tag + ":")
      )
    );
    if (skillMatch === false && statusMatch === false) continue;
    multiplier *= raceAbilityNumber(pack, target, ability, "multiplier", 1.5);
  }
  return multiplier;
}

interface ElementAdjustment {
  readonly relation: "WEAKNESS" | "SAME";
  readonly multiplier: number;
  readonly flat: number;
  /** 防守方本次应对检定的目标修正（弱点 -3 / 同属性 +3）。 */
  readonly defenseMod: number;
  readonly sourceElement: string;
}

/**
 * 属性相克：把「弱点 +2D / 同属性 -2D」换算成管线需要的乘数与固定值。
 *
 * 只对 TOUHOU 且开启 elementRules 的规则包生效；目标没有元素时返回 null。
 * 弱点与同属性同时成立时，按千幻抄「不重复叠加」取弱点。
 */
function resolveElementAdjustment(
  pack: CompiledRulePack,
  state: CombatState,
  attackElement: string | undefined,
  target: CombatParticipantState,
  salt: string
): ElementAdjustment | null {
  if (pack.system !== "TOUHOU") return null;
  const rules = pack.pack.elementRules;
  if (rules.enabled === false) return null;
  const element = attackElement?.trim();
  if (element === undefined || element.length === 0) return null;
  const registry = pack.pack.elements;
  const attackerDef = registry[element];
  if (attackerDef === undefined) return null;
  const targetElements = target.elements ?? [];
  if (targetElements.length === 0) return null;

  const weakness = targetElements.some((targetElement) => {
    if (attackerDef.strongAgainst.includes(targetElement)) return true;
    const targetDef = registry[targetElement];
    return targetDef !== undefined && targetDef.weakTo.includes(element);
  });
  const same = targetElements.includes(element);
  if (weakness === false && same === false) return null;

  const relation = weakness ? "WEAKNESS" : "SAME";
  const diceExpression = weakness ? rules.weaknessDamage : rules.sameElementDamage;
  const flatExpression = weakness ? rules.weaknessFlat : rules.sameElementFlat;
  let amount = 0;
  try {
    const rng = nextRollRng(state, `element:${salt}:${element}:${relation}`);
    amount = rollDice(parseDice(diceExpression), rng).total;
  } catch {
    amount = 0;
  }
  if (Number.isFinite(amount) === false || amount <= 0) {
    try {
      amount = evaluateSource(pack, flatExpression, target.vars);
    } catch {
      amount = 0;
    }
  }
  const magnitude = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  if (magnitude <= 0) return null;

  const resistExpression = weakness ? rules.weaknessResistMod : rules.sameElementResistMod;
  let defenseMod = 0;
  try {
    const value = evaluateSource(pack, resistExpression, target.vars);
    defenseMod = Number.isFinite(value) ? Math.floor(value) : 0;
  } catch {
    defenseMod = 0;
  }

  return {
    relation,
    multiplier: 1,
    flat: relation === "WEAKNESS" ? magnitude : -magnitude,
    defenseMod,
    sourceElement: element
  };
}

/** 存活单位每轮开始时的种族再生量；无能力时为 0。 */
function raceRegenAmount(pack: CompiledRulePack, participant: CombatParticipantState): number {
  if (pack.system !== "TOUHOU") return 0;
  const ability = raceAbilityOf(pack, participant, "REGEN");
  if (ability === null) return 0;
  return Math.max(0, Math.floor(raceAbilityNumber(pack, participant, ability, "amount", 0)));
}

/**
 * 不死种族（蓬莱人）的 HP 归零保护。
 * 触发时把 HP 保留在 reviveHp，不会进入死亡 / 濒死流程，返回 true。
 */
function applyRaceImmortalSurvival(
  ctx: ResolveContext,
  target: CombatParticipantState
): boolean {
  if (ctx.pack.system !== "TOUHOU") return false;
  const ability = raceAbilityOf(ctx.pack, target, "IMMORTAL");
  if (ability === null) return false;
  const reviveHp = Math.max(1, Math.floor(raceAbilityNumber(ctx.pack, target, ability, "reviveHp", 1)));
  target.hp = Math.min(target.maxHp, reviveHp);
  target.dead = false;
  target.dying = false;
  target.unconscious = false;
  target.prone = false;
  target.defeated = false;
  target.isReady = false;
  pushLog(ctx.state, {
    kind: "STATUS",
    actorId: target.id,
    targetId: target.id,
    text: target.name + " 的不死性发动：HP 归零后以 " + target.hp + " HP 保留（不老不死）",
    data: { rollType: "RACE_IMMORTAL", hp: target.hp, reviveHp }
  });
  return true;
}

/** 每轮开始时结算种族再生；只有 TOUHOU 种族会命中。 */
export function resolveRoundRaceAbilities(pack: CompiledRulePack, state: CombatState): void {
  if (pack.system !== "TOUHOU") return;
  for (const participant of [...state.participants]) {
    if (participant.defeated) continue;
    if (participant.hp <= 0 || participant.hp >= participant.maxHp) continue;
    const amount = raceRegenAmount(pack, participant);
    if (amount <= 0) continue;
    const before = participant.hp;
    participant.hp = Math.min(participant.maxHp, before + amount);
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: participant.id,
      text:
        participant.name +
        " 的「再生」回复 " +
        (participant.hp - before) +
        " HP（HP " +
        before +
        " → " +
        participant.hp +
        "）",
      data: { rollType: "RACE_REGEN", heal: participant.hp - before, hp: participant.hp }
    });
  }
}

function applyDamageToParticipant(
  ctx: ResolveContext,
  target: CombatParticipantState,
  amount: number,
  attacker?: CombatParticipantState
): { toDeclaration: number; toHp: number } {
  let remaining = amount;
  let toDeclaration = 0;

  const declaration = target.declaration;
  if (declaration !== null) {
    // 千幻抄：展开型 SC 展开期间，受到的伤害全部由 SC 承受；
    // SC 被击破时的溢出伤害无效，不会继续打到本体。
    const hpBefore = declaration.hp;
    const applied = Math.max(0, Math.floor(remaining));
    declaration.hp = Math.max(0, hpBefore - applied);
    toDeclaration = applied;
    if (declaration.hp <= 0) breakDeclaration(ctx, target, attacker);
    if (applied > hpBefore) {
      pushLog(ctx.state, {
        kind: "DAMAGE",
        actorId: target.id,
        targetId: target.id,
        text:
          target.name +
          " 的符卡承受 " +
          hpBefore +
          " 点伤害后被击破，溢出 " +
          (applied - hpBefore) +
          " 点伤害无效",
        data: { rollType: "SC_OVERFLOW_DISCARD", overflow: applied - hpBefore }
      });
    }
    return { toDeclaration, toHp: 0 };
  }

  // 千幻抄 7.5：结界有自己的 HP，优先于本体承受伤害；击破时溢出无效。
  const barrier = target.barrier ?? null;
  if (barrier !== null && barrier.hp > 0) {
    const hpBefore = barrier.hp;
    const applied = Math.max(0, Math.floor(remaining));
    barrier.hp = Math.max(0, hpBefore - applied);
    if (barrier.hp <= 0) {
      target.barrier = null;
      pushLog(ctx.state, {
        kind: "DAMAGE",
        actorId: target.id,
        targetId: target.id,
        text: target.name + " 的「" + barrier.name + "」承受 " + hpBefore + " 点伤害后被击破，溢出伤害无效",
        data: { rollType: "BARRIER_BROKEN", name: barrier.name, hp: 0 }
      });
    } else {
      pushLog(ctx.state, {
        kind: "DAMAGE",
        actorId: target.id,
        targetId: target.id,
        text: target.name + " 的「" + barrier.name + "」吸收 " + applied + " 点伤害（剩余 HP " + barrier.hp + "）",
        data: { rollType: "BARRIER_ABSORB", name: barrier.name, absorbed: applied, hp: barrier.hp }
      });
    }
    return { toDeclaration: 0, toHp: 0 };
  }

  const bodyDamage = remaining;
  const hpBefore = target.hp;
  const toHp = Math.min(hpBefore, bodyDamage);
  target.hp = hpBefore - toHp;

  // 不死种族（蓬莱人）在 HP 归零时保留不死之身，不进入重伤 / 濒死 / 死亡流程。
  if (target.hp <= 0 && applyRaceImmortalSurvival(ctx, target)) {
    return { toDeclaration, toHp };
  }

  if (combatEventEnabled(ctx.pack, "MAJOR_WOUND")) {
    const threshold = combatEventParam(
      ctx.pack,
      "MAJOR_WOUND",
      "threshold",
      target.vars,
      Math.ceil(target.maxHp / 2)
    );
    const instantDeathThreshold = combatEventParam(
      ctx.pack,
      "MAJOR_WOUND",
      "instantDeathThreshold",
      target.vars,
      target.maxHp
    );

    if (bodyDamage >= instantDeathThreshold) {
      target.hp = 0;
      target.majorWound = true;
      target.prone = true;
      target.unconscious = true;
      target.dead = true;
      target.dying = false;
      target.defeated = true;
      target.isReady = false;
      pushLog(ctx.state, {
        kind: "DEFEAT",
        actorId: target.id,
        targetId: target.id,
        text: target.name + " 单次受到 " + bodyDamage + " 点伤害，达到最大生命值 " + target.maxHp + "，当场死亡",
        data: { rollType: "INSTANT_DEATH", damage: bodyDamage, maxHp: target.maxHp }
      });
      return { toDeclaration, toHp };
    }

    if (bodyDamage >= threshold) {
      target.majorWound = true;
      target.prone = true;
      pushLog(ctx.state, {
        kind: "DAMAGE",
        actorId: target.id,
        targetId: target.id,
        text: target.name + " 单次受到 " + bodyDamage + " 点伤害（重伤阈值 " + threshold + "），受到重伤并倒地",
        data: { rollType: "MAJOR_WOUND", damage: bodyDamage, threshold }
      });

      const conTarget = combatEventParam(
        ctx.pack,
        "MAJOR_WOUND",
        "checkTarget",
        target.vars,
        target.attributes.con
      );
      const rng = nextRollRng(ctx.state, "major-wound:" + target.id + ":" + ctx.state.round);
      const roll = rollDie(rng, 100);
      const check = resolveCheck(ctx.pack, roll, conTarget);
      const success = isSuccess(check.result);
      pushLog(ctx.state, {
        kind: "CHECK",
        actorId: target.id,
        targetId: target.id,
        text: "重伤 CON 检定：" + target.name + " 掷 1d100 = " + roll + "，目标值 " + conTarget + " → " + check.result,
        data: { rollType: "MAJOR_WOUND_CON", roll, target: conTarget, result: check.result }
      });
      if (success === false) {
        target.unconscious = true;
        target.defeated = true;
        target.isReady = false;
        pushLog(ctx.state, {
          kind: "ACTION",
          actorId: target.id,
          targetId: null,
          text: target.name + " 重伤后失去意识。",
          data: { rollType: "MAJOR_WOUND_UNCONSCIOUS" }
        });
      }
    }

    if (target.hp <= 0) {
      target.hp = 0;
      target.prone = true;
      target.unconscious = true;
      target.defeated = true;
      target.isReady = false;
      if (combatEventEnabled(ctx.pack, "DYING") && target.majorWound === true) {
        if (target.dying !== true) target.dyingSinceRound = ctx.state.round;
        target.dying = true;
        pushLog(ctx.state, {
          kind: "DEFEAT",
          actorId: target.id,
          targetId: target.id,
          text: target.name + " 已受重伤且 HP 归零，进入濒死；将在下一轮结束开始进行 CON 检定",
          data: { rollType: "DYING", sinceRound: target.dyingSinceRound ?? ctx.state.round }
        });
      } else {
        pushLog(ctx.state, {
          kind: "DEFEAT",
          actorId: target.id,
          targetId: target.id,
          text: target.name + (target.majorWound === true
            ? " 已受重伤且 HP 归零，但本房未开启濒死规则，失去战斗能力"
            : " HP 归零，陷入昏迷；因其未受重伤，本次不会死亡"),
          data: { rollType: "UNCONSCIOUS", majorWound: target.majorWound === true }
        });
      }
    }
    return { toDeclaration, toHp };
  }

  if (target.hp <= 0) {
    target.hp = 0;
    target.defeated = true;
    target.isReady = false;
    pushLog(ctx.state, {
      kind: "DEFEAT",
      actorId: target.id,
      targetId: target.id,
      text: target.name + " 失去战斗能力"
    });
  }
  return { toDeclaration, toHp };
}

/**
 * COC7 濒死结算：进入濒死后的下一轮结束，以及之后每轮结束，各进行一次 CON 检定。
 * 失败立即死亡；成功则继续撑住，直到被急救 / 医学稳定或治疗。
 */
export function resolveDyingChecks(pack: CompiledRulePack, state: CombatState): void {
  if (combatEventEnabled(pack, "DYING") === false) return;
  for (const participant of state.participants) {
    if (participant.dying !== true || participant.dead === true) continue;
    const delayRounds = combatEventParam(
      pack,
      "DYING",
      "firstCheckDelayRounds",
      participant.vars,
      2
    );
    const sinceRound = participant.dyingSinceRound ?? state.round - 1;
    if (state.round < sinceRound + delayRounds) continue;

    const conTarget = combatEventParam(
      pack,
      "DYING",
      "checkTarget",
      participant.vars,
      participant.attributes.con
    );
    const rng = nextRollRng(state, "dying:" + participant.id + ":" + state.round);
    const roll = rollDie(rng, 100);
    const check = resolveCheck(pack, roll, conTarget);
    const success = isSuccess(check.result);
    pushLog(state, {
      kind: "CHECK",
      actorId: participant.id,
      targetId: participant.id,
      text: "濒死 CON 检定：" + participant.name + " 掷 1d100 = " + roll + "，目标值 " + conTarget + " → " + check.result,
      data: { rollType: "DYING_CON", roll, target: conTarget, result: check.result }
    });
    if (success === false) {
      participant.dead = true;
      participant.dying = false;
      participant.unconscious = true;
      participant.prone = true;
      participant.defeated = true;
      participant.isReady = false;
      pushLog(state, {
        kind: "DEFEAT",
        actorId: participant.id,
        targetId: participant.id,
        text: participant.name + " 濒死 CON 检定失败，死亡",
        data: { rollType: "DYING_DEATH", roll }
      });
    }
  }
}

function compiledSkillBase(
  pack: CompiledRulePack,
  participant: CombatParticipantState,
  skill: string
): number | null {
  const rule = pack.skills.find((item) => item.id === skill);
  if (rule === undefined) return null;
  return Math.floor(evaluate(rule.base, { vars: participant.vars, consts: pack.pack.const }));
}

function skillValueOf(
  pack: CompiledRulePack,
  participant: CombatParticipantState,
  skill: string | undefined,
  fallback: number
): number {
  if (skill === undefined) return fallback;
  const explicit = participant.skills[skill];
  if (typeof explicit === "number") return explicit;
  const base = compiledSkillBase(pack, participant, skill);
  if (base !== null) return base;
  return fallback;
}

function rollCombatCheck(
  pack: CompiledRulePack,
  rng: Rng,
  target: number,
  bonusDice = 0,
  penaltyDice = 0
): { roll: number; check: CheckOutcome; detail: string } {
  const percentile = rollPercentile(rng, bonusDice, penaltyDice);
  return {
    roll: percentile.roll,
    check: resolveCheck(pack, percentile.roll, target),
    detail: percentile.detail
  };
}

interface DiceModifierSource {
  readonly label: string;
  readonly bonusDice: number;
  readonly penaltyDice: number;
}

function diceModifierCount(value: unknown): number {
  if (value === true) return 1;
  if (typeof value !== "number" || Number.isFinite(value) === false) return 0;
  return Math.max(0, Math.min(5, Math.floor(value)));
}

/**
 * 自定义状态提供的战斗修正。
 * data 约定：
 * - attackBonusDice / attackPenaltyDice
 * - defenseBonusDice / defensePenaltyDice
 * 布尔 true 等价于 1；数值会限制在 0–5。
 */
function conditionDiceModifierSources(
  participant: CombatParticipantState,
  side: "attack" | "defense"
): DiceModifierSource[] {
  const sources: DiceModifierSource[] = [];
  for (const condition of participant.conditions ?? []) {
    const data = condition.data ?? {};
    const bonusDice = diceModifierCount(data[side + "BonusDice"]);
    const penaltyDice = diceModifierCount(data[side + "PenaltyDice"]);
    if (bonusDice === 0 && penaltyDice === 0) continue;
    const note = condition.duration.note;
    sources.push({
      label:
        typeof note === "string" && note.length > 0
          ? note
          : condition.type,
      bonusDice,
      penaltyDice
    });
  }
  return sources;
}

/** 防御侧（闪避 / 反击 / 战技对抗）通用修正来源。 */
function defenseDiceModifierSources(participant: CombatParticipantState): DiceModifierSource[] {
  const sources: DiceModifierSource[] = [];
  if (participant.grappledBy !== null && participant.grappledBy !== undefined) {
    sources.push({ label: "被擒抱", bonusDice: 0, penaltyDice: 1 });
  }
  if (
    (participant.conditions ?? []).some(
      (condition) => condition.type === "INSANITY" && condition.data.penaltyDice === 1
    )
  ) {
    sources.push({ label: "疯狂发作", bonusDice: 0, penaltyDice: 1 });
  }
  sources.push(...conditionDiceModifierSources(participant, "defense"));
  return sources;
}

function totalDiceModifiers(sources: readonly DiceModifierSource[]): {
  readonly bonusDice: number;
  readonly penaltyDice: number;
} {
  let bonusDice = 0;
  let penaltyDice = 0;
  for (const source of sources) {
    bonusDice += source.bonusDice;
    penaltyDice += source.penaltyDice;
  }
  return { bonusDice, penaltyDice };
}

/** 把修正来源格式化成可读文本，写入日志避免黑箱。 */
function modifierSourceText(sources: readonly DiceModifierSource[]): string {
  const parts: string[] = [];
  for (const source of sources) {
    if (source.bonusDice === 0 && source.penaltyDice === 0) continue;
    const dice: string[] = [];
    if (source.bonusDice > 0) dice.push(source.bonusDice + " 奖励骰");
    if (source.penaltyDice > 0) dice.push(source.penaltyDice + " 惩罚骰");
    parts.push(source.label + " " + dice.join(" + "));
  }
  if (parts.length === 0) return "";
  return "（修正：" + parts.join("；") + "）";
}

function isCoc7RangedAttackSkill(skill: string): boolean {
  return skill.startsWith("FIREARMS_") || skill === "THROW";
}

function maxDamageOfExpression(source: string): number {
  try {
    return diceBounds(parseDice(source)).max;
  } catch {
    return 0;
  }
}

function formatDiceDetail(
  details: readonly { readonly sign: 1 | -1; readonly count: number; readonly sides: number; readonly values: readonly number[] }[]
): string {
  return details
    .map((detail) => (detail.sign < 0 ? "-" : "+") + detail.count + "d" + detail.sides + "[" + detail.values.join(", ") + "]")
    .join("  ");
}

interface PhysicalDamageOutcome {
  readonly total: number;
  readonly mode: "NORMAL" | "EXTREME_BLUNT" | "EXTREME_IMPALING";
  readonly expression: string;
  readonly detail: string;
}

/**
 * COC7 物理伤害：
 * - 普通成功：正常掷伤害表达式（含 DB）；
 * - 极难 / 大成功：钝击取最大值 + DB；贯穿再额外掷一次武器伤害骰。
 */
function physicalDamageForAttack(
  damageSource: string,
  damageBonus: string,
  damageType: ActionSubmission["damageType"],
  attackCheck: CheckOutcome,
  rng: Rng
): PhysicalDamageOutcome {
  const isExtreme = attackCheck.result === "EXTREME" || attackCheck.result === "CRITICAL";
  const baseExpression = damageSource.replace(/\bdb\b/gi, "0");
  const effectiveDamageBonus = /\bdb\b/i.test(damageSource) ? (damageBonus.length > 0 ? damageBonus : "0") : "0";

  if (isExtreme === false) {
    const expression = expandDamageBonus(damageSource, damageBonus);
    const rolled = rollDice(parseDice(expression), rng);
    return {
      total: rolled.total,
      mode: "NORMAL",
      expression,
      detail: formatDiceDetail(rolled.details)
    };
  }

  const maxBase = maxDamageOfExpression(baseExpression);
  const maxBonus = maxDamageOfExpression(effectiveDamageBonus);
  if (damageType === "IMPALING") {
    const extra = rollDice(parseDice(baseExpression), rng);
    const total = maxBase + maxBonus + extra.total;
    return {
      total,
      mode: "EXTREME_IMPALING",
      expression: maxBase + " + DB " + maxBonus + " + 额外 " + baseExpression,
      detail: "最大武器 " + maxBase + " + DB " + maxBonus + " + 额外 " + baseExpression + " = " + extra.total
    };
  }
  const total = maxBase + maxBonus;
  return {
    total,
    mode: "EXTREME_BLUNT",
    expression: String(maxBase) + " + DB " + String(maxBonus),
    detail: "最大武器 " + maxBase + " + DB " + maxBonus + " = " + total
  };
}

function spellcardEnhanceForAttack(
  pack: CompiledRulePack,
  actor: CombatParticipantState,
  skillName: string
): { readonly accuracyMod: number; readonly damageMultiplier: number; readonly flatDamage: number } | null {
  const declaration = actor.declaration;
  if (declaration === null || declaration.enhanceType === null) return null;
  const type = declaration.enhanceType;
  const isMelee = skillName.startsWith("FIGHTING_") || skillName === "MELEE";
  const isDanmaku =
    skillName === "DANMAKU" || skillName.startsWith("FIREARMS_") || skillName === "THROW";
  if (type === "MELEE" && isMelee === false) return null;
  if (type === "DANMAKU" && isDanmaku === false) return null;
  if (type !== "MELEE" && type !== "DANMAKU" && type !== "AREA") return null;

  const enhance = pack.pack.spellcard?.enhance?.[type];
  const evalOr = (expression: string | undefined, fallback: number): number => {
    if (expression === undefined) return fallback;
    try {
      const value = evaluateSource(pack, expression, actor.vars);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };

  if (type === "MELEE") {
    return {
      accuracyMod: evalOr(enhance?.accuracyMod, 0),
      damageMultiplier: evalOr(enhance?.damageMultiplier, declaration.enhanceValue > 0 ? declaration.enhanceValue : 1),
      flatDamage: 0
    };
  }
  if (type === "DANMAKU") {
    return {
      accuracyMod: 0,
      damageMultiplier: 1,
      flatDamage: evalOr(enhance?.damageFlat, declaration.enhanceValue > 0 ? declaration.enhanceValue : 0)
    };
  }
  return {
    accuracyMod: 0,
    damageMultiplier: declaration.enhanceValue > 0 ? declaration.enhanceValue : 1,
    flatDamage: 0
  };
}

function spellcardEnhanceForSpell(
  pack: CompiledRulePack,
  actor: CombatParticipantState
): { readonly flat: number; readonly multiplier: number } {
  const declaration = actor.declaration;
  if (declaration === null || declaration.enhanceType !== "SPELL") {
    return { flat: 0, multiplier: 1 };
  }
  const enhance = pack.pack.spellcard?.enhance?.SPELL;
  let flat = 0;
  try {
    flat = enhance?.abilityMod !== undefined ? evaluateSource(pack, enhance.abilityMod, actor.vars) : 0;
  } catch {
    flat = 0;
  }
  return {
    flat: Number.isFinite(flat) ? flat : 0,
    multiplier: declaration.enhanceValue > 0 ? declaration.enhanceValue : 1
  };
}

function consumeGrazeDamageBonus(actor: CombatParticipantState, skillName: string): number {
  const bonus = Math.max(0, Math.floor(actor.grazeDamageBonus ?? 0));
  if (bonus <= 0) return 0;
  const isMelee = skillName.startsWith("FIGHTING_") || skillName === "MELEE";
  const kind = actor.grazeDamageBonusKind;
  if ((kind === "MELEE" && isMelee) || (kind === "RANGED" && isMelee === false)) {
    actor.grazeDamageBonus = 0;
    actor.grazeDamageBonusKind = undefined;
    return bonus;
  }
  return 0;
}

function resolveAttack(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  defender: CombatParticipantState
): void {
  const state = ctx.state;
  const rng = nextRollRng(state, `attack:${actor.id}`);
  const isCoc7 = ctx.pack.system === "COC7";
  const skillName = submission.skill ?? "DANMAKU";
  const enhance = spellcardEnhanceForAttack(ctx.pack, actor, skillName);
  const grazeDamageBonus = consumeGrazeDamageBonus(actor, skillName);
  const target =
    skillValueOf(ctx.pack, actor, skillName, 0) +
    (submission.accuracyMod ?? 0) +
    (enhance?.accuracyMod ?? 0);

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

  // COC7：火器不能被闪避/反击；服务端应只下发 PASS / SEEK_COVER，引擎再做一道防线。
  if (
    isCoc7 &&
    isCoc7RangedAttackSkill(skillName) &&
    (reaction.type === "DODGE" || reaction.type === "COUNTER")
  ) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: defender.id,
      targetId: actor.id,
      text: defender.name + " 不能对火器使用" + (reaction.type === "DODGE" ? "闪避" : "反击") + "，按未应对处理"
    });
    reaction = { type: "PASS" };
  }

  const attackModifierSources: DiceModifierSource[] = [];
  const submittedBonusDice = diceModifierCount(submission.bonusDice);
  const submittedPenaltyDice = diceModifierCount(submission.penaltyDice);
  if (submittedBonusDice > 0 || submittedPenaltyDice > 0) {
    attackModifierSources.push({
      label:
        submission.bonusDiceSource !== undefined && submission.bonusDiceSource.length > 0
          ? submission.bonusDiceSource
          : (submission.shotCount ?? 1) > 1
            ? "连射"
            : "行动修正",
      bonusDice: submittedBonusDice,
      penaltyDice: submittedPenaltyDice
    });
  }
  if (isCoc7 && actor.grappledBy !== null && actor.grappledBy !== undefined) {
    attackModifierSources.push({ label: "被擒抱", bonusDice: 0, penaltyDice: 1 });
  }
  if (
    isCoc7 &&
    (actor.conditions ?? []).some(
      (condition) => condition.type === "INSANITY" && condition.data.penaltyDice === 1
    )
  ) {
    attackModifierSources.push({ label: "疯狂发作", bonusDice: 0, penaltyDice: 1 });
  }
  attackModifierSources.push(...conditionDiceModifierSources(actor, "attack"));
  let coverForfeited = false;

  // 寻找掩体：成功使攻击者本次射击承受 1 枚惩罚骰；无论成功与否都放弃下一次攻击。
  // 同一动作内多次射击共享同一次掩体检定。
  if (reaction.type === "SEEK_COVER") {
    if (isCoc7 === false || isCoc7RangedAttackSkill(skillName) === false) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: defender.id,
        targetId: actor.id,
        text: defender.name + " 的寻找掩体不适用于本次攻击，按未应对处理"
      });
      reaction = { type: "PASS" };
    } else {
      const coverKey = actor.id + ":" + defender.id;
      let coverResult = ctx.coverCache?.get(coverKey);
      if (coverResult === undefined) {
        const coverTarget = skillValueOf(ctx.pack, defender, reaction.skill ?? "DODGE", defender.attributes.dex);
        const cover = rollCombatCheck(ctx.pack, rng, coverTarget);
        const coverSuccess = isSuccess(cover.check.result);
        coverResult = { penaltyDice: coverSuccess ? 1 : 0, forfeited: true };
        ctx.coverCache?.set(coverKey, coverResult);
        pushLog(state, {
          kind: "CHECK",
          actorId: defender.id,
          targetId: actor.id,
          text:
            "寻找掩体检定：" +
            defender.name +
            " 掷 1d100 = " +
            cover.roll +
            "，目标值 " +
            coverTarget +
            " → " +
            cover.check.result +
            (coverSuccess ? "（攻击者本次射击承受 1 枚惩罚骰）" : "（掩体失败）"),
          data: { rollType: "SEEK_COVER", roll: cover.roll, target: coverTarget, result: cover.check.result, success: coverSuccess }
        });
      }
      if (coverResult.penaltyDice > 0) {
        attackModifierSources.push({
          label: "目标寻找掩体",
          bonusDice: 0,
          penaltyDice: coverResult.penaltyDice
        });
      }
      coverForfeited = coverResult.forfeited;
    }
  }

  const shotText =
    submission.shotCount !== undefined && submission.shotCount > 1
      ? "（第 " + ((submission.shotIndex ?? 0) + 1) + "/" + submission.shotCount + " 发）"
      : "";

  // COC7 寡不敌众：目标本轮已经闪避/反击过，后续近战攻击 +1 奖励骰。
  if (isCoc7 && skillName.startsWith("FIGHTING_") && (defender.reactionsThisRound ?? 0) > 0) {
    attackModifierSources.push({ label: "寡不敌众", bonusDice: 1, penaltyDice: 0 });
  }

  const attackDice = totalDiceModifiers(attackModifierSources);
  const attackBonusDice = attackDice.bonusDice;
  const attackPenaltyDice = attackDice.penaltyDice;
  const attackUsesPercentile = isCoc7 || attackBonusDice > 0 || attackPenaltyDice > 0;
  const attack = attackUsesPercentile
    ? rollCombatCheck(ctx.pack, rng, target, attackBonusDice, attackPenaltyDice)
    : (() => {
        const rawRoll = rollDie(rng, 100);
        return { roll: rawRoll, check: resolveCheck(ctx.pack, rawRoll, target), detail: "" };
      })();
  const attackRoll = attack.roll;
  const attackCheck = attack.check;
  const attackRollDetail =
    attackUsesPercentile && attackBonusDice + attackPenaltyDice > 0 ? "（" + attack.detail + "）" : "";
  const attackModifierText = modifierSourceText(attackModifierSources);

  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text:
      "攻击检定：" +
      actor.name +
      " 使用「" +
      skillName +
      "」掷 1d100 = " +
      attackRoll +
      "，目标值 " +
      target +
      " → " +
      attackCheck.result +
      attackRollDetail +
      attackModifierText +
      shotText,
    data: {
      rollType: "ATTACK",
      skill: skillName,
      roll: attackRoll,
      target,
      result: attackCheck.result,
      shotIndex: submission.shotIndex ?? 0,
      shotCount: submission.shotCount ?? 1,
      modifiers: attackModifierText
    }
  });

  if (isSuccess(attackCheck.result) === false) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: "攻击落空：" + actor.name + " 的 1d100 = " + attackRoll + " 未通过「" + skillName + "」检定",
      data: { rollType: "ATTACK", roll: attackRoll, target }
    });
    if (coverForfeited) {
      const alreadyForfeited = (defender.skipNextAction ?? 0) > 0;
      defender.skipNextAction = Math.max(1, defender.skipNextAction ?? 0);
      if (alreadyForfeited === false) {
        pushLog(state, {
          kind: "STATUS",
          actorId: defender.id,
          targetId: null,
          text: defender.name + " 寻找掩体后放弃下一次攻击",
          data: { rollType: "SEEK_COVER_FORFEIT" }
        });
      }
    }
    return;
  }

  const elementAdjustment = resolveElementAdjustment(
    ctx.pack,
    state,
    submission.element,
    defender,
    `attack:${actor.id}:${submission.shotIndex ?? 0}`
  );
  const elementDefenseMod = elementAdjustment?.defenseMod ?? 0;

  let defenseSuccess = false;
  let counterDamageSource: string | null = null;
  const counterLabel = isCoc7 ? "反击" : "消弹对抗";

  if (reaction.type === "DODGE") {
    const dodgeTarget =
      skillValueOf(ctx.pack, defender, reaction.skill ?? "DODGE", defender.attributes.dex) +
      elementDefenseMod;
    const dodgeUsesPercentile = isCoc7 || attackUsesPercentile;
    const dodgeModifierSources = isCoc7 ? defenseDiceModifierSources(defender) : [];
    const dodgeDice = totalDiceModifiers(dodgeModifierSources);
    const dodgeModifierText = modifierSourceText(dodgeModifierSources);
    const dodge = dodgeUsesPercentile
      ? rollCombatCheck(ctx.pack, rng, dodgeTarget, dodgeDice.bonusDice, dodgeDice.penaltyDice)
      : (() => {
          const rawRoll = rollDie(rng, 100);
          return { roll: rawRoll, check: resolveCheck(ctx.pack, rawRoll, dodgeTarget), detail: "" };
        })();
    if (isCoc7) {
      defenseSuccess = dodge.check.rank >= attackCheck.rank;
    } else {
      defenseSuccess = isSuccess(dodge.check.result);
    }
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text:
        (isCoc7 ? "闪避" : "擦弹") +
        "检定：" +
        defender.name +
        " 掷 1d100 = " +
        dodge.roll +
        "，目标值 " +
        dodgeTarget +
        " → " +
        dodge.check.result +
        dodgeModifierText +
        (isCoc7 ? "（攻击 " + attackCheck.result + "）" : ""),
      data: {
        rollType: "DODGE",
        roll: dodge.roll,
        target: dodgeTarget,
        result: dodge.check.result,
        attackResult: attackCheck.result,
        success: defenseSuccess,
        modifiers: dodgeModifierText
      }
    });
  } else if (reaction.type === "DEFEND" && isCoc7 === false) {
    // 千幻抄防御：用近战技能与攻击方对抗；成功免伤，失败按规则包 failReduce 减伤。
    const defendTarget =
      skillValueOf(ctx.pack, defender, reaction.skill ?? "MELEE", defender.attributes.str) +
      elementDefenseMod;
    const defend = rollCombatCheck(ctx.pack, rng, defendTarget);
    defenseSuccess = defend.check.rank >= attackCheck.rank;
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text:
        "防御对抗：" +
        defender.name +
        " 掷 1d100 = " +
        defend.roll +
        "，目标值 " +
        defendTarget +
        " → " +
        defend.check.result +
        "（攻击 " +
        attackCheck.result +
        "）→ " +
        (defenseSuccess ? "防御成功" : "防御失败"),
      data: {
        rollType: "DEFEND",
        roll: defend.roll,
        target: defendTarget,
        result: defend.check.result,
        attackResult: attackCheck.result,
        success: defenseSuccess
      }
    });
  } else if (reaction.type === "COUNTER") {
    const counterTarget =
      skillValueOf(
        ctx.pack,
        defender,
        reaction.skill ?? (isCoc7 ? "FIGHTING_BRAWL" : "DANMAKU"),
        defender.attributes.dex
      ) + elementDefenseMod;
    if (isCoc7 || attackUsesPercentile) {
      const counterModifierSources = isCoc7 ? defenseDiceModifierSources(defender) : [];
      const counterDice = totalDiceModifiers(counterModifierSources);
      const counterModifierText = modifierSourceText(counterModifierSources);
      const counter = rollCombatCheck(
        ctx.pack,
        rng,
        counterTarget,
        counterDice.bonusDice,
        counterDice.penaltyDice
      );
      if (isCoc7) {
        defenseSuccess = counter.check.rank > attackCheck.rank;
        if (defenseSuccess) counterDamageSource = reaction.damage ?? "1d3+db";
      } else {
        const opposed = resolveOpposed(
          ctx.pack,
          { roll: attackRoll, target },
          { roll: counter.roll, target: counterTarget }
        );
        defenseSuccess = opposed.winner === "DEFENDER";
      }
      pushLog(state, {
        kind: "CHECK",
        actorId: defender.id,
        targetId: actor.id,
        text:
          counterLabel +
          "对抗：攻击方 " +
          attackRoll +
          "/" +
          target +
          " vs " +
          defender.name +
          " " +
          counter.roll +
          "/" +
          counterTarget +
          " → " +
          defender.name +
          (defenseSuccess ? "成功" : "失败") +
          counterModifierText,
        data: {
          rollType: "COUNTER",
          attackRoll,
          attackTarget: target,
          counterRoll: counter.roll,
          counterTarget,
          success: defenseSuccess,
          attackResult: attackCheck.result,
          counterResult: counter.check.result,
          modifiers: counterModifierText
        }
      });
    } else {
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
        text:
          counterLabel +
          "对抗：攻击方 " +
          attackRoll +
          "/" +
          target +
          " vs " +
          defender.name +
          " " +
          counterRoll +
          "/" +
          counterTarget +
          " → " +
          defender.name +
          (defenseSuccess ? "成功" : "失败"),
        data: { rollType: "COUNTER", attackRoll, attackTarget: target, counterRoll, counterTarget, success: defenseSuccess }
      });
    }
  }

  if (isCoc7 && (reaction.type === "DODGE" || reaction.type === "COUNTER")) {
    defender.reactionsThisRound = (defender.reactionsThisRound ?? 0) + 1;
  }

  let damageTotal = 0;
  let damageExpression = "";
  let damageDetail = "";
  let damageModeText = "";
  if (isCoc7) {
    const physical = physicalDamageForAttack(
      submission.damage ?? "0",
      actor.damageBonus,
      submission.damageType,
      attackCheck,
      nextRollRng(state, `damage:${actor.id}:${defender.id}`)
    );
    damageTotal = physical.total;
    damageExpression = physical.expression;
    damageDetail = physical.detail;
    damageModeText =
      physical.mode === "NORMAL" ? "" : physical.mode === "EXTREME_IMPALING" ? "（贯穿极限伤害）" : "（钝击极限伤害）";
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: defender.id,
      text:
        "伤害骰：" +
        actor.name +
        " 的「" +
        damageExpression +
        "」= " +
        damageTotal +
        damageModeText +
        "（" +
        damageDetail +
        "）" +
        shotText,
      data: {
        rollType: "DAMAGE_ROLL",
        expression: damageExpression,
        roll: damageTotal,
        mode: physical.mode,
        shotIndex: submission.shotIndex ?? 0,
        shotCount: submission.shotCount ?? 1
      }
    });
  } else {
    const damageSource = expandDamageBonus(submission.damage ?? "0", actor.damageBonus);
    const damageRng = nextRollRng(state, `damage:${actor.id}:${defender.id}`);
    const damageRoll = rollDice(parseDice(damageSource), damageRng);
    damageTotal = damageRoll.total;
    damageExpression = damageSource;
    damageDetail = formatDiceDetail(damageRoll.details);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: defender.id,
      text:
        "伤害骰：" +
        actor.name +
        " 的「" +
        damageSource +
        "」= " +
        damageRoll.total +
        "（" +
        damageDetail +
        "），范围 " +
        damageRoll.min +
        "~" +
        damageRoll.max +
        shotText,
      data: {
        rollType: "DAMAGE_ROLL",
        expression: damageSource,
        roll: damageRoll.total,
        min: damageRoll.min,
        max: damageRoll.max,
        shotIndex: submission.shotIndex ?? 0,
        shotCount: submission.shotCount ?? 1
      }
    });
  }

  if (isCoc7 === false && reaction.type === "DODGE" && defenseSuccess) {
    // 千幻抄：成功回避不再直接回灵，而是积攒擦弹点数；点数由玩家用 PASS 行动消费。
    const grazeGain = Math.max(1, Math.floor(damageTotal / 2));
    defender.grazePoints = Math.max(0, Math.floor(defender.grazePoints ?? 0)) + grazeGain;
    pushLog(state, {
      kind: "STATUS",
      actorId: defender.id,
      targetId: actor.id,
      text: defender.name + " 擦弹 +" + grazeGain + "（当前 " + defender.grazePoints + "）",
      data: { rollType: "GRAZE_GAIN", grazeGain, grazePoints: defender.grazePoints }
    });
  }

  const shieldMultiplier = damageMultiplierOf(ctx.pack, defender.statusEffects, defender.vars);
  const raceMultiplier = raceIncomingMultiplier(ctx.pack, defender, skillName);

  const outcome = applyDamagePipeline(ctx.pack, {
    baseDamage: damageTotal,
    defense: reaction.type,
    defenseSuccess,
    spellcardMultiplier: enhance?.damageMultiplier,
    enhanceFlat: (enhance?.flatDamage ?? 0) + grazeDamageBonus,
    raceMultiplier,
    elementMultiplier: elementAdjustment?.multiplier,
    elementFlat: elementAdjustment?.flat,
    shieldMultiplier,
    vars: defender.vars
  });

  if (outcome.mpCost > 0) {
    defender.mp = Math.max(0, defender.mp - outcome.mpCost);
    applyTouhouMpExhaustion(ctx, defender);
  }
  if (outcome.mpGained > 0) {
    defender.mp = Math.min(defender.maxMp, defender.mp + outcome.mpGained);
    clearTouhouMpExhaustion(ctx, defender);
  }

  const armorResult = absorbWithArmor(defender, outcome.damage);
  const applied = applyDamageToParticipant(ctx, defender, armorResult.remaining, actor);
  const defenseText =
    reaction.type === "PASS"
      ? "未应对"
      : reaction.type === "DODGE"
        ? (isCoc7 ? "闪避" : "擦弹") + (defenseSuccess ? "成功" : "失败")
        : reaction.type === "COUNTER"
          ? counterLabel + (defenseSuccess ? "成功" : "失败")
          : reaction.type === "SEEK_COVER"
            ? "寻找掩体"
            : "防御" + (defenseSuccess ? "成功" : "失败");

  pushLog(state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: defender.id,
    text:
      "伤害结算：" +
      actor.name +
      " → " +
      defender.name +
      "，应对=" +
      defenseText +
      "，原始 " +
      damageTotal +
      " → 最终 " +
      outcome.damage +
      (armorResult.absorbed > 0 ? "，护甲吸收 " + armorResult.absorbed + "（剩余 " + defender.armor + "）" : "") +
      (outcome.steps.length === 0 ? "" : "（" + outcome.steps.join("；") + "）") +
      shotText,
    data: {
      rollType: "DAMAGE_SETTLE",
      rawDamage: damageTotal,
      damage: outcome.damage,
      armorAbsorbed: armorResult.absorbed,
      armorRemaining: defender.armor,
      defense: reaction.type,
      defenseSuccess,
      steps: outcome.steps.join("；"),
      toDeclaration: applied.toDeclaration,
      toHp: applied.toHp,
      mpCost: outcome.mpCost,
      mpGained: outcome.mpGained
    }
  });

  // COC7 反击成功：防守方对攻击者造成一次常规伤害。
  if (counterDamageSource !== null) {
    const counterExpression = expandDamageBonus(counterDamageSource, defender.damageBonus);
    const counterRoll = rollDice(parseDice(counterExpression), nextRollRng(state, `counter-damage:${defender.id}:${actor.id}`));
    pushLog(state, {
      kind: "DAMAGE",
      actorId: defender.id,
      targetId: actor.id,
      text: "反击伤害骰：" + defender.name + " 的「" + counterExpression + "」= " + counterRoll.total + "（" + formatDiceDetail(counterRoll.details) + "）",
      data: { rollType: "COUNTER_DAMAGE_ROLL", expression: counterExpression, roll: counterRoll.total }
    });
    const counterArmor = absorbWithArmor(actor, counterRoll.total);
    const counterApplied = applyDamageToParticipant(ctx, actor, counterArmor.remaining, defender);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: defender.id,
      targetId: actor.id,
      text:
        "反击伤害结算：" +
        defender.name +
        " → " +
        actor.name +
        "，最终 " +
        Math.max(0, counterRoll.total - counterArmor.absorbed) +
        (counterArmor.absorbed > 0 ? "，护甲吸收 " + counterArmor.absorbed : ""),
      data: {
        rollType: "COUNTER_DAMAGE_SETTLE",
        rawDamage: counterRoll.total,
        armorAbsorbed: counterArmor.absorbed,
        toHp: counterApplied.toHp
      }
    });
  }

  if (coverForfeited) {
    const alreadyForfeited = (defender.skipNextAction ?? 0) > 0;
    defender.skipNextAction = Math.max(1, defender.skipNextAction ?? 0);
    if (alreadyForfeited === false) {
      pushLog(state, {
        kind: "STATUS",
        actorId: defender.id,
        targetId: null,
        text: defender.name + " 寻找掩体后放弃下一次攻击",
        data: { rollType: "SEEK_COVER_FORFEIT" }
      });
    }
  }
}

function resolveManeuver(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  defender: CombatParticipantState
): void {
  const state = ctx.state;
  if (ctx.pack.system !== "COC7") {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: defender.id,
      text: "只有 COC7 支持战技"
    });
    return;
  }
  const maneuver = submission.maneuver;
  if (maneuver === undefined) {
    pushLog(state, { kind: "SYSTEM", actorId: actor.id, targetId: defender.id, text: "缺少战技类型" });
    return;
  }
  const actorBuild = coc7Build(actor.attributes.str + actor.attributes.siz);
  const defenderBuild = coc7Build(defender.attributes.str + defender.attributes.siz);
  if (defenderBuild >= actorBuild + 3) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: actor.name + " 对 " + defender.name + " 使用战技失败：对方体格高 3 点以上，战技无法进行",
      data: { rollType: "MANEUVER", maneuver, impossible: true }
    });
    return;
  }
  const buildPenalty = Math.min(2, Math.max(0, defenderBuild - actorBuild));
  const grapplePenalty = actor.grappledBy !== null && actor.grappledBy !== undefined ? 1 : 0;
  const penaltyDice = buildPenalty + grapplePenalty;
  const rng = nextRollRng(state, `maneuver:${actor.id}:${defender.id}`);
  const target = skillValueOf(ctx.pack, actor, "FIGHTING_BRAWL", actor.attributes.dex);
  const attack = rollCombatCheck(ctx.pack, rng, target, 0, penaltyDice);
  const labels: Record<NonNullable<ActionSubmission["maneuver"]>, string> = {
    DISARM: "缴械",
    TRIP: "踢倒",
    GRAPPLE: "擒拿"
  };
  const label = labels[maneuver];
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text:
      "战技（" +
      label +
      "）检定：" +
      actor.name +
      " 掷 1d100 = " +
      attack.roll +
      "，目标值 " +
      target +
      "（体格差惩罚骰 " +
      penaltyDice +
      "）→ " +
      attack.check.result,
    data: { rollType: "MANEUVER_ATTACK", maneuver, roll: attack.roll, target, result: attack.check.result, penaltyDice }
  });
  if (isSuccess(attack.check.result) === false) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: actor.name + " 的战技（" + label + "）失败",
      data: { rollType: "MANEUVER", maneuver, success: false }
    });
    return;
  }

  let reaction = reactionFor(ctx, defender.id);
  if (reaction.type === "SEEK_COVER" || reaction.type === "DEFEND") reaction = { type: "PASS" };
  let defenderWins = false;
  if (reaction.type === "DODGE") {
    const dodgeTarget = skillValueOf(ctx.pack, defender, reaction.skill ?? "DODGE", defender.attributes.dex);
    const dodge = rollCombatCheck(ctx.pack, rng, dodgeTarget);
    defenderWins = dodge.check.rank >= attack.check.rank;
    defender.reactionsThisRound = (defender.reactionsThisRound ?? 0) + 1;
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text: "战技闪避检定：" + defender.name + " 掷 1d100 = " + dodge.roll + "，目标值 " + dodgeTarget + " → " + dodge.check.result,
      data: { rollType: "MANEUVER_DODGE", roll: dodge.roll, target: dodgeTarget, result: dodge.check.result, success: defenderWins }
    });
  } else if (reaction.type === "COUNTER") {
    const counterTarget = skillValueOf(
      ctx.pack,
      defender,
      reaction.skill ?? "FIGHTING_BRAWL",
      defender.attributes.dex
    );
    const counter = rollCombatCheck(ctx.pack, rng, counterTarget);
    defenderWins = counter.check.rank > attack.check.rank;
    defender.reactionsThisRound = (defender.reactionsThisRound ?? 0) + 1;
    pushLog(state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: actor.id,
      text: "战技反击对抗：" + defender.name + " 掷 1d100 = " + counter.roll + "，目标值 " + counterTarget + " → " + counter.check.result,
      data: { rollType: "MANEUVER_COUNTER", roll: counter.roll, target: counterTarget, result: counter.check.result, success: defenderWins }
    });
  } else {
    pushLog(state, {
      kind: "ACTION",
      actorId: defender.id,
      targetId: actor.id,
      text: defender.name + " 未应对战技",
      data: { rollType: "MANEUVER", success: false }
    });
  }

  if (defenderWins) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: defender.id,
      text: defender.name + " 化解了" + actor.name + " 的战技（" + label + "）",
      data: { rollType: "MANEUVER", maneuver, success: false }
    });
    return;
  }

  if (maneuver === "TRIP") {
    defender.prone = true;
  } else if (maneuver === "GRAPPLE") {
    defender.grappledBy = actor.id;
  } else {
    defender.disarmed = true;
  }
  pushLog(state, {
    kind: "ACTION",
    actorId: actor.id,
    targetId: defender.id,
    text:
      actor.name +
      " 的战技（" +
      label +
      "）成功：" +
      (maneuver === "TRIP" ? defender.name + " 倒地" : maneuver === "GRAPPLE" ? defender.name + " 被擒抱" : defender.name + " 被缴械"),
    data: { rollType: "MANEUVER", maneuver, success: true }
  });
}

/**
 * 千幻抄 4.8 / 4.12：展开型 SC 展开时、消费型 SC 发动时，
 * 回复「DP 上限的一半（向上取整）」。
 */
function recoverSpellcardDp(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  name: string,
  mode: "DECLARATION" | "CONSUMPTION"
): void {
  if (ctx.pack.pack.dp === undefined) return;
  const recover = Math.ceil(Math.max(0, Math.floor(actor.maxDp)) / 2);
  if (recover <= 0) return;
  const before = Math.max(0, Math.floor(actor.dp));
  actor.dp = Math.min(actor.maxDp, before + recover);
  const gained = actor.dp - before;
  if (gained <= 0) return;
  pushLog(ctx.state, {
    kind: "SPELLCARD",
    actorId: actor.id,
    targetId: null,
    text: actor.name + " 因「" + name + "」回复 " + gained + " DP（" + actor.dp + " / " + actor.maxDp + "）",
    data: { rollType: "SPELLCARD_DP_RECOVER", mode, name, gained, dp: actor.dp }
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
  const cardId = submission.spellCardId ?? null;
  const usedKey = cardId ?? name;

  // 千幻抄 4.15：使用过 LSC 后不能再使用其他符卡。
  if (actor.lscUsed === true) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 已使用 LSC，本场无法再使用符卡"
    });
    return;
  }

  // 千幻抄 6.1.2：一方本场可用的 SC 总数有限，用完即无法再展开 / 消费。
  if (ctx.pack.system === "TOUHOU" && state.spellcardBattle !== null && state.spellcardBattle !== undefined) {
    const side = actor.faction ?? "ALLY";
    const declared = state.spellcardBattle.declaredCardIds?.[side];
    if (declared !== undefined && cardId !== null && declared.includes(cardId) === false) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: "本场未宣言符卡「" + name + "」，无法发动",
        data: { rollType: "SPELLCARD_NOT_DECLARED", side, cardId }
      });
      return;
    }
    const cap = Math.max(0, Math.floor(state.spellcardBattle.sideUsable[side] ?? 0));
    const used = state.participants
      .filter((participant) => (participant.faction ?? "ALLY") === side)
      .reduce((sum, participant) => sum + participant.usedSpellCards.length, 0);
    if (used >= cap) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: (side === "ALLY" ? "我方" : "敌方") + "本场可用符卡已用完（" + used + "/" + cap + "），无法发动「" + name + "」",
        data: { rollType: "SPELLCARD_POOL_EMPTY", side, used, cap }
      });
      return;
    }
  }

  if (rules.consumption.oncePerCombat === true && actor.usedSpellCards.includes(usedKey)) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: `${actor.name} 的符卡「${name}」本场已使用过`
    });
    return;
  }

  const effects = submission.effects ?? [];
  const targetScope = submission.targetScope ?? "ONE";
  const targeting = submission.targeting ?? (targetScope === "SELF" ? "SELF" : "ENEMY");

  if (mode === "CONSUMPTION") {
    actor.usedSpellCards = [...actor.usedSpellCards, usedKey];
    actor.mp = Math.max(0, actor.mp - mpCost);
    applyTouhouMpExhaustion(ctx, actor);
    recoverSpellcardDp(ctx, actor, name, "CONSUMPTION");
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: submission.targetId ?? null,
      text: `${actor.name} 发动消费型符卡「${name}」，附带消弹`,
      data: {
        event: "CONSUME",
        mode: "CONSUMPTION",
        name,
        mpCost,
        cardId
      }
    });
    for (const queued of ctx.queue) {
      if (queued.kind !== "DANMAKU") continue;
      if (queued.actorId === actor.id) continue;
      ctx.cancelled.add(queued.actorId);
    }
    if (effects.length > 0) {
      const spell: MagicSpell = {
        id: cardId ?? ("spellcard:" + name),
        name,
        skill: "SPELLCARD_CRAFT",
        mpCost: "0",
        sanCost: "0",
        target: targetScope,
        targeting,
        effects: [...effects]
      };
      resolveTargetedEffects(ctx, actor, submission, spell, { mpCost: 0, sanCost: 0 }, {
        logKind: "SPELLCARD",
        verb: "发动"
      });
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

  actor.usedSpellCards = [...actor.usedSpellCards, usedKey];
  actor.mp = Math.max(0, actor.mp - mpCost);
  applyTouhouMpExhaustion(ctx, actor);
  recoverSpellcardDp(ctx, actor, name, "DECLARATION");
  const rawDuration = Math.max(0, Math.floor(submission.declarationDurationTicks ?? 0));
  // 不传持续 tick 视为“持续到被击破”。不能用 Infinity：CombatState 会写入
  // JSON 快照，Infinity 会被序列化成 null 导致重载后立刻过期。
  const perpetual = rawDuration <= 0;
  const durationTicks = perpetual ? 1_000_000_000 : Math.max(1, rawDuration);

  const clearTargets = submission.declarationClearTargets ?? rules.declaration.clearTargets;
  const enhanceValue =
    submission.spellcardEnhanceValue !== undefined && submission.spellcardEnhanceValue > 0
      ? submission.spellcardEnhanceValue
      : 1;
  const isLsc = submission.declarationLsc === true;
  actor.declaration = {
    name,
    hp: declarationHp,
    maxHp: declarationHp,
    expiresAtTick: state.tick + durationTicks,
    clearTargets,
    cardId,
    damageMultiplier: 1,
    enhanceType: submission.spellcardEnhanceType ?? null,
    enhanceValue,
    isLsc
  };
  if (isLsc) {
    actor.lscUsed = true;
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 宣告 LSC「" + name + "」：本场不能再使用其他符卡",
      data: { rollType: "LSC_DECLARED", name, cardId }
    });
  }

  pushLog(state, {
    kind: "SPELLCARD",
    actorId: actor.id,
    targetId: null,
    text: `${actor.name} 展开符卡「${name}」，独立 HP ${declarationHp}`,
    data: {
      event: "DECLARE",
      mode: "DECLARATION",
      name,
      hp: declarationHp,
      durationTicks: perpetual ? -1 : durationTicks,
      cardId
    }
  });

  if (effects.length > 0) {
    const spell: MagicSpell = {
      id: cardId ?? ("spellcard:" + name),
      name,
      skill: "SPELLCARD_CRAFT",
      mpCost: "0",
      sanCost: "0",
      target: targetScope,
      targeting,
      effects: [...effects]
    };
    resolveTargetedEffects(ctx, actor, submission, spell, { mpCost: 0, sanCost: 0 }, {
      logKind: "SPELLCARD",
      verb: "展开"
    });
  }
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
  applyTouhouMpExhaustion(ctx, actor);
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

interface LevelScalingSpec {
  readonly levelDice?: { readonly die: number; readonly perLevel: number };
  readonly levelBonus?: string;
}

/**
 * 能力等级缩放（LvD / +Lv）。
 * - levelDice：每 perLevel 级追加 1 颗 die 面骰；
 * - levelBonus：固定值表达式，可用 abilityLv 变量。
 */
function levelScalingFor(
  ctx: ResolveContext,
  state: CombatState,
  spec: LevelScalingSpec,
  abilityLevel: number,
  target: CombatParticipantState,
  salt: string
): { dice: number; flat: number } {
  const level = Math.max(0, Math.floor(abilityLevel));
  let diceTotal = 0;
  if (level > 0 && spec.levelDice !== undefined) {
    const perLevel = Math.max(1, Math.floor(spec.levelDice.perLevel));
    const count = Math.floor(level / perLevel);
    if (count > 0) {
      try {
        diceTotal = Math.max(
          0,
          rollDice(parseDice(count + "d" + spec.levelDice.die), nextRollRng(state, "level-dice:" + salt)).total
        );
      } catch {
        diceTotal = 0;
      }
    }
  }
  let flat = 0;
  if (spec.levelBonus !== undefined) {
    try {
      flat = Math.floor(evaluateEffectNumber(ctx.pack, spec.levelBonus, { ...target.vars, abilityLv: level }));
    } catch {
      flat = 0;
    }
  }
  return { dice: diceTotal, flat };
}

/** 没有独立召唤物卡片时使用的通用兜底模板。 */
function genericSummonTemplate(pack: CompiledRulePack, name: string): SummonTemplate {
  const attributes: AttributeSet = {
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
  const outcome = computeDerived(pack, { attributes, skills: {} });
  return {
    name: name.trim().length > 0 ? name.trim() : "召唤物",
    attributes: outcome.attributes,
    derived: outcome.derived,
    skills: {},
    spells: [],
    damageBonus: "0"
  };
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
  requestedTargetId: string | null,
  /** 是否允许选中「已失去战斗能力但未死亡」的目标（用于千幻抄救助昏迷 / 灵力归零者）。 */
  includeDowned = false
): CombatParticipantState[] {
  const targeting = spellTargeting(spell);
  const alive = state.participants.filter(
    (participant) =>
      participant.defeated === false || (includeDowned && participant.dead !== true && participant.hp > 0)
  );
  if (spellEffectsOf(spell).some((effect) => effect.type === "SUMMON")) return [actor];
  if (targeting === "SELF" || spell.target === "SELF") return [actor];
  if (spell.target === "ALL") {
    if (targeting === "ENEMY") return alive.filter((participant) => participant.faction !== actor.faction);
    if (targeting === "ALLY") return alive.filter((participant) => participant.faction === actor.faction);
    return alive;
  }
  if (requestedTargetId === null) return [];
  const target = findParticipant(state, requestedTargetId);
  if (target === undefined) return [];
  if (target.dead === true) return [];
  if (target.defeated && includeDowned === false) return [];
  return [target];
}

/**
 * 计算一个行动需要哪些单位进入「应对窗口」。
 * - 普通攻击：单个目标；
 * - 敌对法术：单体目标；群体法术（target=ALL）返回全部命中目标，保证 AOE 每个人都要应对。
 */
/** DP 掩护候选：目标 + 目标的同阵营存活队友（队友可声明 COVER 代替承受伤害）。 */
function withDpCoverAllies(
  state: CombatState,
  actor: CombatParticipantState,
  targetIds: readonly string[]
): string[] {
  const result = new Set<string>();
  for (const id of targetIds) {
    const target = findParticipant(state, id);
    if (target === undefined || target.defeated) continue;
    result.add(target.id);
    if (target.faction === undefined) continue;
    for (const participant of state.participants) {
      if (participant.defeated || participant.id === actor.id) continue;
      if (participant.faction === target.faction) result.add(participant.id);
    }
  }
  return [...result];
}

export function reactionTargetIdsForAction(
  pack: CompiledRulePack,
  state: CombatState,
  action: ActionSubmission
): string[] {
  const actor = findParticipant(state, action.actorId);
  if (actor === undefined || actor.defeated) return [];
  const requestedTargetId = action.targetId ?? null;

  if (action.kind === "DANMAKU") {
    // DP 弹幕：无判定打全体，所有敌对单位都要决定是否消耗 DP 回避。
    if (action.dpAction === "DANMAKU") {
      return state.participants
        .filter((participant) => participant.defeated === false && participant.faction !== actor.faction)
        .map((participant) => participant.id);
    }
    // DP 追击：每个目标都要决定应对；目标队友可声明掩护。
    if (action.dpAction === "CHASE") {
      const ids = (action.dpTargetIds ?? (requestedTargetId === null ? [] : [requestedTargetId])).filter((id) => {
        const target = findParticipant(state, id);
        return target !== undefined && target.defeated === false && target.id !== actor.id;
      });
      return withDpCoverAllies(state, actor, ids);
    }
    // DP 其他判定：不进入应对窗口。
    if (action.dpAction === "SKILL") return [];
    // DP 射击 / 近战：目标 + 目标队友的掩护窗口。
    if (action.dpAction === "RANGED" || action.dpAction === "MELEE") {
      if (requestedTargetId === null || requestedTargetId === actor.id) return [];
      return withDpCoverAllies(state, actor, [requestedTargetId]);
    }
    if (action.routine !== undefined && action.routine.length > 0) {
      const ids = new Set<string>();
      for (const step of action.routine) {
        if (step.targetId === actor.id) continue;
        const target = findParticipant(state, step.targetId);
        if (target === undefined || target.defeated) continue;
        ids.add(target.id);
      }
      return [...ids];
    }
    if (requestedTargetId === null || requestedTargetId === actor.id) return [];
    const target = findParticipant(state, requestedTargetId);
    return target === undefined || target.defeated ? [] : [target.id];
  }

  if (action.kind === "MANEUVER") {
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

  if (action.kind === "ITEM") {
    const effects = action.effects ?? [];
    if (effects.length === 0) return [];
    const targeting = action.targeting ?? "ENEMY";
    if (targeting === "ALLY" || targeting === "SELF") return [];
    const spell: MagicSpell = {
      id: action.itemCardId ?? "item",
      name: action.name ?? "道具",
      skill: "ITEM",
      mpCost: "0",
      sanCost: "0",
      target: action.targetScope ?? "ONE",
      targeting,
      effects: [...effects]
    };
    if (isHostileSpell(spell) === false) return [];
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
  spell: { readonly id: string; readonly name: string },
  effect: MagicEffect,
  defense: { readonly type: DefenseType; readonly success: boolean },
  submission: ActionSubmission,
  logKind: LogEntry["kind"] = "SPELLCARD",
  verb = "施放"
): void {
  const state = ctx.state;
  const meta = { spellId: spell.id, spell: spell.name };
  const log = (text: string, data: Record<string, unknown> = {}): void => {
    pushLog(state, {
      kind: logKind,
      actorId: actor.id,
      targetId: target.id,
      text,
      data: { ...meta, ...data }
    });
  };

  if (effect.type === "DAMAGE") {
    const spellEnhance = spellcardEnhanceForSpell(ctx.pack, actor);
    const rolled = rollEffectDice(effect.amount, state, "magic-damage:" + actor.id + ":" + spell.id + ":" + target.id);
    const levelScaling = levelScalingFor(
      ctx,
      state,
      effect,
      submission.abilityLevel ?? 0,
      target,
      actor.id + ":" + spell.id + ":" + target.id
    );
    const base = rolled + spellEnhance.flat + levelScaling.dice + levelScaling.flat;
    const scalingText =
      levelScaling.dice + levelScaling.flat === 0
        ? ""
        : "，能力等级 +" + (levelScaling.dice + levelScaling.flat);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: target.id,
      text: "伤害骰：「" + spell.name + "」对 " + target.name + " 的 " + effect.amount + " = " + rolled + (spellEnhance.flat > 0 ? "，符卡强化 +" + spellEnhance.flat : "") + scalingText + "，合计 " + base,
      data: { ...meta, rollType: "DAMAGE_ROLL", expression: effect.amount, roll: rolled, enhanceFlat: spellEnhance.flat, levelDice: levelScaling.dice, levelBonus: levelScaling.flat }
    });
    const shieldMultiplier = damageMultiplierOf(ctx.pack, target.statusEffects, target.vars);
    const spellDef = ctx.pack.pack.magic?.spells.find((entry) => entry.id === spell.id);
    const raceMultiplier = raceIncomingMultiplier(ctx.pack, target, spellDef?.skill);
    const elementAdjustment = resolveElementAdjustment(
      ctx.pack,
      state,
      effect.element ?? spellDef?.element,
      target,
      `magic:${actor.id}:${spell.id}`
    );
    const outcome = applyDamagePipeline(ctx.pack, {
      baseDamage: base,
      defense: defense.type,
      defenseSuccess: defense.success,
      spellcardMultiplier: spellEnhance.multiplier,
      raceMultiplier,
      elementMultiplier: elementAdjustment?.multiplier,
      elementFlat: elementAdjustment?.flat,
      shieldMultiplier,
      vars: target.vars
    });
    if (outcome.mpCost > 0) {
      target.mp = Math.max(0, target.mp - outcome.mpCost);
      applyTouhouMpExhaustion(ctx, target);
    }
    if (outcome.mpGained > 0) {
      target.mp = Math.min(target.maxMp, target.mp + outcome.mpGained);
      clearTouhouMpExhaustion(ctx, target);
    }
    const armorResult = absorbWithArmor(target, outcome.damage);
    const applied = applyDamageToParticipant(ctx, target, armorResult.remaining, actor);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: target.id,
      text: "伤害结算：「" + spell.name + "」→ " + target.name + "，应对=" + defense.type + (defense.type === "PASS" ? "" : defense.success ? "成功" : "失败") + "，原始 " + base + " → 最终 " + outcome.damage + (armorResult.absorbed > 0 ? "，护甲吸收 " + armorResult.absorbed + "（剩余 " + target.armor + "）" : "") + (outcome.steps.length === 0 ? "" : "（" + outcome.steps.join("；") + "）"),
      data: { ...meta, rollType: "DAMAGE_SETTLE", rawDamage: base, damage: outcome.damage, armorAbsorbed: armorResult.absorbed, armorRemaining: target.armor, defense: defense.type, defenseSuccess: defense.success, steps: outcome.steps.join("；"), toDeclaration: applied.toDeclaration, toHp: applied.toHp }
    });
    return;
  }

  if (effect.type === "HEAL") {
    const spellEnhance = spellcardEnhanceForSpell(ctx.pack, actor);
    const rolled = rollEffectDice(effect.amount, state, "magic-heal:" + actor.id + ":" + spell.id + ":" + target.id);
    const levelScaling = levelScalingFor(
      ctx,
      state,
      effect,
      submission.abilityLevel ?? 0,
      target,
      actor.id + ":" + spell.id + ":" + target.id
    );
    const amount = Math.max(
      0,
      Math.floor((rolled + spellEnhance.flat + levelScaling.dice + levelScaling.flat) * spellEnhance.multiplier)
    );
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 恢复 " + (target.hp - before) + " HP" + (spellEnhance.flat + levelScaling.dice + levelScaling.flat + (spellEnhance.multiplier !== 1 ? 1 : 0) > 0 ? "（强化）" : ""), { heal: target.hp - before, enhanceFlat: spellEnhance.flat, levelDice: levelScaling.dice, levelBonus: levelScaling.flat, enhanceMultiplier: spellEnhance.multiplier });
    return;
  }

  if (effect.type === "MP_RESTORE") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const before = target.mp;
    target.mp = Math.min(target.maxMp, target.mp + amount);
    clearTouhouMpExhaustion(ctx, target);
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 恢复 " + (target.mp - before) + " MP", { mp: target.mp - before });
    return;
  }

  if (effect.type === "MP_DRAIN") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const drained = Math.min(target.mp, amount);
    target.mp = Math.max(0, target.mp - drained);
    applyTouhouMpExhaustion(ctx, target);
    actor.mp = Math.min(actor.maxMp, actor.mp + drained);
    clearTouhouMpExhaustion(ctx, actor);
    log(actor.name + " " + verb + "「" + spell.name + "」 → 抽取 " + target.name + " " + drained + " MP", { drained });
    return;
  }

  if (effect.type === "SAN_LOSS") {
    const amount = rollEffectDice(effect.amount, state, "magic-san-loss:" + actor.id + ":" + spell.id + ":" + target.id);
    const before = target.san;
    target.san = Math.max(0, target.san - amount);
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 失去 " + (before - target.san) + " SAN", { sanLoss: before - target.san });
    return;
  }

  if (effect.type === "SAN_RESTORE") {
    const amount = evaluateEffectNumber(ctx.pack, effect.amount, actor.vars);
    const before = target.san;
    target.san = Math.min(target.maxSan, target.san + amount);
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 恢复 " + (target.san - before) + " SAN", { sanGain: target.san - before });
    return;
  }

  if (effect.type === "STATUS") {
    const stacks = Math.max(1, evaluateEffectNumber(ctx.pack, effect.stacks, actor.vars));
    applyStatus(ctx.pack, state, target.id, effect.key, stacks);
    return;
  }

  if (effect.type === "BARRIER") {
    const hp = Math.max(0, rollEffectDice(effect.hp, state, "magic-barrier:" + actor.id + ":" + spell.id + ":" + target.id));
    const duration = Math.max(0, Math.floor(evaluateEffectNumber(ctx.pack, effect.durationTicks, actor.vars)));
    target.barrier = {
      hp,
      maxHp: hp,
      name: effect.name.length > 0 ? effect.name : "结界",
      expiresAtRound: duration > 0 ? state.round + duration : null
    };
    log(
      actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 展开「" + target.barrier.name + "」（HP " + hp + "）",
      { rollType: "BARRIER_APPLIED", barrierHp: hp, barrierMaxHp: hp, expiresAtRound: target.barrier.expiresAtRound ?? 0 }
    );
    return;
  }

  if (effect.type === "ARMOR") {
    const amount = rollEffectDice(effect.amount, state, "magic-armor:" + actor.id + ":" + spell.id + ":" + target.id);
    const duration = evaluateEffectNumber(ctx.pack, effect.durationTicks, actor.vars);
    target.armor = Math.max(0, Math.floor(target.armor ?? 0) + amount);
    target.maxArmor = Math.max(target.maxArmor ?? 0, target.armor);
    target.armorExpiresAtRound = duration > 0 ? state.round + duration : null;
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 获得护甲 " + amount + "（当前 " + target.armor + "）", { armor: amount, armorRemaining: target.armor, armorExpiresAtRound: target.armorExpiresAtRound ?? 0 });
    return;
  }

  if (effect.type === "SUMMON") {
    const count = Math.max(1, Math.min(8, Math.floor(evaluateEffectNumber(ctx.pack, effect.count, actor.vars))));
    const duration = evaluateEffectNumber(ctx.pack, effect.durationTicks, actor.vars);
    for (let index = 0; index < count; index += 1) {
      const template = submission.summonTemplate ?? genericSummonTemplate(ctx.pack, effect.name ?? "召唤物");
      const ordinal = (state.summonSeq ?? 0) + 1;
      state.summonSeq = ordinal;
      const id = "summon-" + actor.id + "-" + String(ordinal);
      const vars = { ...template.attributes, ...template.derived };
      let summonArmor = 0;
      if (template.armorExpression !== undefined && template.armorExpression.length > 0) {
        try {
          summonArmor = Math.max(0, rollDice(parseDice(template.armorExpression), nextRollRng(state, "summon-armor:" + id)).total);
        } catch {
          summonArmor = 0;
        }
      }
      const summoned = addParticipant(state, {
        id,
        name: count > 1 ? template.name + " " + String(index + 1) : template.name,
        kind: "NPC",
        characterId: null,
        faction: actor.faction,
        attributes: template.attributes,
        derived: template.derived,
        skills: { ...(template.skills ?? {}) },
        spells: [...(template.spells ?? [])],
        damageBonus: template.damageBonus ?? "0",
        atbMax: computeAtbMax(ctx.pack, vars),
        speed: computeBaseSpeed(ctx.pack, vars),
        isIdentified: true,
        isPublic: false,
        armor: summonArmor,
        summonedBy: actor.id,
        summonedName: template.name,
        summonExpiresAtRound: duration > 0 ? state.round + duration : null
      });
      if (state.mode === "INITIATIVE" && state.initiativeOrder.includes(summoned.id) === false) {
        state.initiativeOrder = [...state.initiativeOrder, summoned.id];
      }
      pushLog(state, {
        kind: "SPELLCARD",
        actorId: actor.id,
        targetId: summoned.id,
        text: actor.name + " " + verb + "「" + spell.name + "」 → 召唤了「" + summoned.name + "」",
        data: { spellId: spell.id, spell: spell.name, summonId: summoned.id, summonName: summoned.name }
      });
    }
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
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 获得持续伤害 " + amount + "（" + duration + " tick）", { dot: amount, duration });
    return;
  }

  if (effect.type === "STUN") {
    const actions = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationActions, actor.vars));
    target.stunActions = Math.max(target.stunActions ?? 0, actions);
    target.atbValue = 0;
    target.isReady = false;
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 眩晕，跳过 " + actions + " 次行动", { stunActions: actions });
    return;
  }

  if (effect.type === "CONTROL") {
    const actions = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationActions, actor.vars));
    target.controlActions = Math.max(target.controlActions ?? 0, actions);
    log(actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + " 被控制，跳过 " + actions + " 次行动", { controlActions: actions });
    return;
  }

  if (effect.type === "POSSESS") {
    const charges = Math.max(1, evaluateEffectNumber(ctx.pack, effect.durationTurns, actor.vars));
    target.possessedBy = actor.id;
    target.possessCharges = charges;
    log(actor.name + " " + verb + "「" + spell.name + "」 → 夺舍 " + target.name + "，充能 " + charges + " 格（战斗轮次 + 被夺舍 Token 移动共用）", {
      possession: true,
      possessedBy: actor.id,
      possessCharges: charges
    });
    return;
  }

  if (effect.type === "CLEANSE") {
    clearStatuses(target, effect.keys);
    log(actor.name + " " + verb + "「" + spell.name + "」 → 净化 " + target.name + " 的 " + (effect.keys.length === 0 ? "持续伤害 / 控制" : effect.keys.join("、")), { cleanse: true });
    return;
  }

  if (effect.type === "DISPEL") {
    let removedStatuses = 0;
    if (effect.keys.length === 0) {
      removedStatuses = (target.statusEffects ?? []).length;
      target.statusEffects = [];
      target.stunActions = 0;
      target.controlActions = 0;
    } else {
      const before = (target.statusEffects ?? []).length;
      clearStatuses(target, effect.keys);
      removedStatuses = before - (target.statusEffects ?? []).length;
    }
    let brokeDeclaration = false;
    if (effect.declaration && target.declaration !== null) {
      breakDeclaration(ctx, target, actor);
      brokeDeclaration = true;
    }
    log(
      actor.name +
        " " +
        verb +
        "「" +
        spell.name +
        "」 → 驱散 " +
        target.name +
        " 的 " +
        (effect.keys.length === 0 ? "全部状态" : effect.keys.join("、")) +
        "（移除 " +
        removedStatuses +
        " 个" +
        (brokeDeclaration ? "，并击破其展开中的符卡" : "") +
        "）",
      { dispel: true, removedStatuses, brokeDeclaration }
    );
  }
}

/** 眩晕 / 控制的单位进入行动位时强制跳过。 */
export function applyForcedSkips(state: CombatState): void {
  for (const participant of state.participants) {
    if (participant.defeated || participant.isReady === false) continue;
    const stun = participant.stunActions ?? 0;
    const control = participant.controlActions ?? 0;
    const skip = participant.skipNextAction ?? 0;
    if (stun + control + skip <= 0) continue;
    if (state.pending[participant.id] !== undefined) continue;
    if (stun > 0) participant.stunActions = stun - 1;
    else if (control > 0) participant.controlActions = control - 1;
    else participant.skipNextAction = Math.max(0, skip - 1);
    state.pending[participant.id] = { actorId: participant.id, kind: "PASS" };
    pushLog(state, {
      kind: "STATUS",
      actorId: participant.id,
      targetId: null,
      text:
        participant.name +
        (stun > 0 ? " 因眩晕跳过行动" : control > 0 ? " 因控制跳过行动" : " 因寻找掩体放弃下一次攻击")
    });
  }
}

/** 在规则包的 magic.spells 里按 id / name 找法术。 */
function findMagicSpell(
  pack: CompiledRulePack,
  submission: ActionSubmission
): MagicSpell | undefined {
  return pack.pack.magic?.spells.find(
    (item) => item.id === submission.spellId || item.name === submission.name
  );
}

/**
 * 计算一次施法的 MP / SAN 消耗。
 * sanSalt 保持与旧调用完全一致，避免改变 COC7 的 RNG 流。
 */
function spellCostFor(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  spell: MagicSpell,
  sanSalt: string
): { mpCost: number; sanCost: number } {
  const mpCost = Math.max(0, Math.floor(evaluateSource(ctx.pack, spell.mpCost, actor.vars)));
  let sanCost = 0;
  try {
    sanCost = Math.max(
      0,
      rollDice(parseDice(spell.sanCost), nextRollRng(ctx.state, sanSalt + ":" + spell.id)).total
    );
  } catch {
    sanCost = 0;
  }
  return { mpCost, sanCost };
}

/**
 * 效果执行的公共出口。COC7 魔法、千幻抄能力、道具都复用同一套效果结算；
 * 调用方负责完成习得 / 发动 / 目标 / 消耗校验。
 */
function executeSpellEffects(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  spell: MagicSpell,
  cost: { mpCost: number; sanCost: number },
  options: { logKind?: LogEntry["kind"]; verb?: string } = {}
): void {
  resolveTargetedEffects(ctx, actor, submission, spell, cost, {
    logKind: options.logKind ?? "SPELLCARD",
    verb: options.verb ?? "施放"
  });
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
  const spell = findMagicSpell(ctx.pack, submission);
  if (spell === undefined) {
    pushLog(state, { kind: "SYSTEM", actorId: actor.id, targetId: null, text: "没有找到这个法术" });
    return;
  }

  const cost = spellCostFor(ctx, actor, spell, "magic-san:" + actor.id);
  if (spendCombatMagicPoints(ctx, actor, cost.mpCost, "法术「" + spell.name + "」") === false) return;
  actor.san = Math.max(0, actor.san - cost.sanCost);

  executeSpellEffects(ctx, actor, submission, spell, cost, { logKind: "SPELLCARD", verb: "施放" });
}

/** 抵抗判定：目标 {属性}+〈抵抗〉+3D6 ≥ 10 + 施术者 Lv + 达成值×2 的十位数。 */
function rollAbilityResist(
  ctx: ResolveContext,
  caster: CombatParticipantState,
  target: CombatParticipantState,
  spell: MagicSpell,
  casterLevel: number,
  casterAchievement: number
): boolean {
  const resist = spell.resist;
  if (resist === undefined) return false;
  const isDp = ctx.state.mode === "DP";

  // 千幻抄抵抗：{意志}或{耐久}+〈抵抗〉Lv+ND6（最多 resistMaxDice 颗，消耗 DP）。
  let dpDice = 0;
  let dpInsufficient = false;
  if (isDp && resist.dice !== "1D100") {
    const dpRules = ctx.pack.pack.dp;
    const perDie = Math.max(0, Math.floor(dpRules.actionCosts.resistPerDie));
    const requested = clampTouhouDpDice(
      reactionFor(ctx, target.id).dpDice ?? dpRules.actionCosts.resistMaxDice,
      dpRules.actionCosts.resistMaxDice
    );
    if (perDie > 0) {
      const affordable = Math.floor(target.dp / perDie);
      dpDice = Math.max(0, Math.min(requested, affordable));
      dpInsufficient = dpDice <= 0;
      if (dpInsufficient === false) spendDp(ctx, target, perDie * dpDice, "抵抗 " + dpDice + "D");
    } else {
      dpDice = requested;
    }
  }

  const rawAttribute = target.attributes[resist.attribute as keyof AttributeSet] ?? target.vars[resist.attribute] ?? 0;
  const attributeValue = isDp ? dpAttribute(ctx.pack, target, resist.attribute) : rawAttribute;
  const skill = isDp
    ? dpSkillLevel(ctx.pack, target, resist.skill)
    : skillValueOf(ctx.pack, target, resist.skill, attributeValue);
  const base = attributeValue + skill;
  const reactionBonus = passiveBonus(target, "reactionBonus");
  const targetValue = touhouResistTargetValue(casterLevel, casterAchievement);
  const rng = nextRollRng(ctx.state, `ability-resist:${caster.id}:${target.id}:${spell.id}`);
  let roll = 0;
  let total = base;
  let success = false;
  let diceText = "";
  if (dpInsufficient) {
    diceText = "DP 不足，无法抵抗";
    success = false;
  } else if (resist.dice === "1D100") {
    roll = rollDie(rng, 100);
    total = base + reactionBonus;
    success = roll <= total;
    diceText = "1d100=" + roll + " / 目标 " + total;
  } else if (isDp) {
    roll = dpDice > 0 ? rollDice(parseDice(dpDice + "d6"), rng).total : 0;
    total = base + roll + reactionBonus;
    success = total >= targetValue;
    diceText = dpDice + "d6=" + roll + " + " + base + " = " + total + " / 目标 " + targetValue;
  } else {
    roll = rollDice(parseDice("3d6"), rng).total;
    total = base + roll + reactionBonus;
    success = total >= targetValue;
    diceText = "3d6=" + roll + " + " + base + " = " + total + " / 目标 " + targetValue;
  }
  pushLog(ctx.state, {
    kind: "CHECK",
    actorId: target.id,
    targetId: caster.id,
    text: target.name + " 抵抗「" + spell.name + "」：" + diceText + " → " + (success ? "抵抗成功" : "抵抗失败"),
    data: {
      rollType: isDp ? "DP_ABILITY_RESIST" : "ABILITY_RESIST",
      roll,
      base,
      total,
      targetValue,
      success,
      dpDice: isDp ? dpDice : 0,
      dpInsufficient
    }
  });
  return success;
}

/**
 * 千幻抄 4.9：在反应窗口等任意时机即时展开符卡。
 *
 * 与普通 SPELLCARD 行动共用 resolveSpellcard 的校验与结算（含宣言限制 / 池上限），
 * 但不占用行动者的回合行动；调用方负责把它接在反应窗口里。
 */
export function resolveSpellcardImmediate(
  pack: CompiledRulePack,
  state: CombatState,
  actorId: string,
  submission: ActionSubmission
): void {
  const actor = findParticipant(state, actorId);
  if (actor === undefined || actor.defeated) return;
  const ctx: ResolveContext = {
    pack,
    state,
    reactions: {},
    queue: [],
    cancelled: new Set<string>(),
    coverCache: new Map()
  };
  resolveSpellcard(ctx, actor, { ...submission, actorId });
}

/**
 * 千幻抄能力发动。
 *
 * 与 resolveMagic 的区别：需要已习得等级、掷发动判定、失败也消耗灵力、可被抵抗；
 * 成功后才复用 executeSpellEffects 执行既有 MagicEffect。
 */
function resolveAbility(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  spell: MagicSpell
): void {
  const state = ctx.state;
  const abilityId = spell.abilityId;
  const rules = ctx.pack.pack.abilities;
  const category = abilityId === undefined ? undefined : resolveAbilityCategory(rules, abilityId);
  if (abilityId === undefined || category === undefined) {
    resolveMagic(ctx, actor, submission);
    return;
  }

  const level = Math.max(0, Math.floor(actor.abilityLevels?.[abilityId] ?? 0));
  const requiredLevel = Math.max(1, Math.floor(spell.requiredLevel ?? 1));
  if (level < requiredLevel) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 未达到「" + category.name + "」Lv" + requiredLevel + "，无法发动「" + spell.name + "」",
      data: { rollType: "ABILITY_LEARN", abilityId, level, requiredLevel }
    });
    return;
  }

  const activation = spell.activation;
  const usePercentile = activation?.dice === "1D100";
  const instanceAttribute = abilityId === undefined ? undefined : actor.abilityAttributes?.[abilityId];
  const fallbackActivationAttribute = category.activationAttribute;

  // DP 模式：能力发动改为消费 DP 骰的 {特性值}+Lv+ND6 判定（最多 maxDicePerCheck）。
  const isDp = state.mode === "DP";
  let dpDice = 0;
  if (isDp && usePercentile === false) {
    // 千幻抄 6.11：原则上每回合只能发动一次能力。
    if (actor.abilityUsedThisRound === true) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: actor.name + " 本回合已经发动过能力，无法再次发动「" + spell.name + "」",
        data: { rollType: "ABILITY_ALREADY_USED", abilityId }
      });
      return;
    }
    const dpRules = ctx.pack.pack.dp;
    const perDie = Math.max(0, Math.floor(dpRules.actionCosts.abilityPerDie));
    dpDice = clampTouhouDpDice(submission.dpDice ?? dpRules.maxDicePerCheck, dpRules.maxDicePerCheck);
    if (spendDp(ctx, actor, perDie * dpDice, "能力发动 " + dpDice + "D") === false) return;
    actor.abilityUsedThisRound = true;
  }

  const attributeKey = activation?.attribute ?? instanceAttribute ?? fallbackActivationAttribute;
  const rawAttribute = actor.attributes[attributeKey as keyof AttributeSet] ?? actor.vars[attributeKey] ?? 0;
  const attributeValue = isDp ? dpAttribute(ctx.pack, actor, attributeKey) : rawAttribute;
  let modifier = 0;
  try {
    modifier = Math.floor(evaluateSource(ctx.pack, activation?.modifier ?? "0", actor.vars));
  } catch {
    modifier = 0;
  }
  const base = attributeValue + level + modifier;
  const accuracyBonus = passiveBonus(actor, "accuracyBonus");
  const rng = nextRollRng(state, `ability:${actor.id}:${spell.id}`);
  let roll = 0;
  let target = base;
  let achievement = base;
  let success = false;
  let diceText = "";
  if (usePercentile) {
    roll = rollDie(rng, 100);
    success = roll <= base + accuracyBonus;
    diceText = "1d100=" + roll + " / 目标 " + (base + accuracyBonus);
  } else if (isDp) {
    roll = dpDice > 0 ? rollDice(parseDice(dpDice + "d6"), rng).total : 0;
    achievement = base + roll + accuracyBonus;
    try {
      target = Math.floor(evaluateSource(ctx.pack, activation?.target ?? "12", actor.vars));
    } catch {
      target = 12;
    }
    success = achievement >= target;
    diceText = dpDice + "d6=" + roll + " + " + base + " = " + achievement + " / 目标 " + target;
  } else {
    roll = rollDice(parseDice("3d6"), rng).total;
    achievement = base + roll + accuracyBonus;
    try {
      target = Math.floor(evaluateSource(ctx.pack, activation?.target ?? "12", actor.vars));
    } catch {
      target = 12;
    }
    success = achievement >= target;
    diceText = "3d6=" + roll + " + " + base + " = " + achievement + " / 目标 " + target;
  }
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: submission.targetId ?? null,
    text: actor.name + " 发动「" + spell.name + "」：" + diceText + " → " + (success ? "成功" : "失败"),
    data: {
      rollType: "ABILITY_ACTIVATION",
      abilityId,
      level,
      roll,
      base,
      achievement,
      target,
      success,
      dpDice: isDp ? dpDice : 0,
      mode: isDp ? "DP" : "STANDARD"
    }
  });

  const cost = spellCostFor(ctx, actor, spell, "ability-san:" + actor.id);
  // 千幻抄：发动失败也消耗灵力。
  if (spendCombatMagicPoints(ctx, actor, cost.mpCost, "能力「" + spell.name + "」") === false) return;
  actor.san = Math.max(0, actor.san - cost.sanCost);
  if (success === false) {
    pushLog(state, {
      kind: "SPELLCARD",
      actorId: actor.id,
      targetId: submission.targetId ?? null,
      text: actor.name + " 发动「" + spell.name + "」失败，灵力仍被消耗",
      data: { rollType: "ABILITY_FAIL", abilityId, mpCost: cost.mpCost, sanCost: cost.sanCost }
    });
    return;
  }

  const targetId = submission.targetId ?? null;
  const targetParticipant = targetId === null ? undefined : findParticipant(state, targetId);
  if (targetParticipant !== undefined && targetParticipant.id !== actor.id && spell.resist !== undefined) {
    const resisted = rollAbilityResist(ctx, actor, targetParticipant, spell, level, achievement);
    if (resisted) {
      pushLog(state, {
        kind: "SPELLCARD",
        actorId: actor.id,
        targetId: targetParticipant.id,
        text: targetParticipant.name + " 抵抗成功，「" + spell.name + "」被无效化",
        data: { rollType: "ABILITY_RESISTED", abilityId, spellId: spell.id }
      });
      return;
    }
  }

  executeSpellEffects(
    ctx,
    actor,
    { ...submission, abilityLevel: level },
    spell,
    cost,
    { logKind: "SPELLCARD", verb: "发动" }
  );
}

/**
 * 道具行动：把道具卡上的通用效果当作一次「法术」结算。
 *
 * 道具的 MP / SAN 消耗由服务端按卡牌数据写入 submission；
 * 使用次数与冷却在 socket 层校验并扣减，这里只负责效果。
 */
function resolveItem(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const effects = submission.effects ?? [];
  const itemName = submission.name ?? "道具";
  if (effects.length === 0) {
    pushLog(state, {
      kind: "ACTION",
      actorId: actor.id,
      targetId: submission.targetId ?? null,
      text: actor.name + " 使用了「" + itemName + "」，但没有可结算效果"
    });
    return;
  }

  const mpCost = Math.max(0, Math.floor(submission.mpCost ?? 0));
  let sanCost = 0;
  if (typeof submission.sanCost === "string" && submission.sanCost.trim().length > 0) {
    try {
      sanCost = Math.max(
        0,
        rollDice(parseDice(submission.sanCost), nextRollRng(state, "item-san:" + actor.id + ":" + (submission.itemCardId ?? itemName))).total
      );
    } catch {
      sanCost = 0;
    }
  }
  if (spendCombatMagicPoints(ctx, actor, mpCost, "道具「" + itemName + "」") === false) return;
  actor.san = Math.max(0, actor.san - sanCost);

  const targetScope = submission.targetScope ?? (submission.targeting === "SELF" ? "SELF" : "ONE");
  const spell: MagicSpell = {
    id: submission.itemCardId ?? ("item:" + itemName),
    name: itemName,
    skill: "ITEM",
    mpCost: "0",
    sanCost: "0",
    target: targetScope,
    targeting: submission.targeting ?? (targetScope === "SELF" ? "SELF" : "ENEMY"),
    effects: [...effects]
  };
  resolveTargetedEffects(ctx, actor, submission, spell, { mpCost, sanCost }, { logKind: "ACTION", verb: "使用" });
}

/**
 * 对一组目标结算一个「效果集合」。
 *
 * 魔法与道具共用：调用方负责把卡牌 / 法术解析成同一套 MagicSpell 描述与消耗，
 * 这里只处理目标选择、应对窗口（闪避 / 防御）、逐条效果结算。
 */
function resolveTargetedEffects(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  spell: MagicSpell,
  costs: { readonly mpCost: number; readonly sanCost: number },
  options: { readonly logKind: LogEntry["kind"]; readonly verb: string }
): void {
  const state = ctx.state;
  const mpCost = costs.mpCost;
  const sanCost = costs.sanCost;
  const verb = options.verb;
  const logKind = options.logKind;
  const meta = { spellId: spell.id, spell: spell.name };

  const requestedTargetId = submission.targetId ?? null;
  // 千幻抄允许治疗 / 回灵类法术救助「灵力归零昏迷」的队友；敌人伤害仍跳过倒地目标。
  const includeDowned = ctx.pack.system === "TOUHOU" && isHostileSpell(spell) === false;
  const targets = resolveMagicTargets(state, actor, spell, requestedTargetId, includeDowned);
  if (targets.length === 0) {
    pushLog(state, {
      kind: logKind,
      actorId: actor.id,
      targetId: requestedTargetId,
      text: actor.name + " " + verb + "「" + spell.name + "」，但目标已不在场，消耗 MP " + mpCost + " / SAN " + sanCost,
      data: { ...meta, mpCost, sanCost }
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
      const dodgeTarget = skillValueOf(ctx.pack, target, effectiveReaction.skill ?? "DODGE", target.attributes.dex);
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
          kind: logKind,
          actorId: actor.id,
          targetId: target.id,
          text: target.name + " 成功避开了「" + spell.name + "」",
          data: { ...meta, evaded: true, mpCost, sanCost }
        });
        continue;
      }
      defense = { type: "DODGE", success: false };
    } else if (target.id !== actor.id && effectiveReaction.type === "DEFEND") {
      defense = { type: "DEFEND", success: true };
    }

    if (effects.length === 0) {
      pushLog(state, {
        kind: logKind,
        actorId: actor.id,
        targetId: target.id,
        text: actor.name + " " + verb + "「" + spell.name + "」 → " + target.name + "（无直接效果）",
        data: { ...meta, mpCost, sanCost }
      });
      continue;
    }

    // 允许对「施法前已昏迷、但未死亡」的队友结算治疗 / 回灵；
    // 若是本次效果把目标打到失去战斗能力，则后续效果不再继续。
    const wasDowned = target.defeated;
    for (const effect of effects) {
      if (target.dead === true) break;
      if (target.defeated && wasDowned === false) break;
      applyMagicEffect(ctx, actor, target, spell, effect, defense, submission, logKind, verb);
    }
  }
}

function resolveGrazeSpend(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  spend: "MP" | "MELEE_DAMAGE" | "RANGED_DAMAGE"
): void {
  const state = ctx.state;
  const points = Math.max(0, Math.floor(actor.grazePoints ?? 0));
  if (points <= 0) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 没有擦弹点数"
    });
    return;
  }
  if (spend === "MP") {
    const use = Math.floor(points / 5) * 5;
    if (use < 5) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: actor.id,
        targetId: null,
        text: actor.name + " 的擦弹点数不足 5 点，无法回复灵力"
      });
      return;
    }
    actor.grazePoints = points - use;
    const restored = use / 5;
    actor.mp = Math.min(actor.maxMp, actor.mp + restored);
    actor.vars.mp = actor.mp;
    clearTouhouMpExhaustion(ctx, actor);
    pushLog(state, {
      kind: "STATUS",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 消费擦弹 " + use + " 点，回复灵力 " + restored + "（剩余擦弹 " + actor.grazePoints + "）",
      data: { rollType: "GRAZE_SPEND_MP", spent: use, mpRestored: restored, grazePoints: actor.grazePoints }
    });
    return;
  }
  if (spend === "MELEE_DAMAGE") {
    actor.grazePoints = 0;
    actor.grazeDamageBonus = (actor.grazeDamageBonus ?? 0) + points;
    actor.grazeDamageBonusKind = "MELEE";
    pushLog(state, {
      kind: "STATUS",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 消费擦弹 " + points + " 点，下次近战伤害 +" + points,
      data: { rollType: "GRAZE_SPEND_MELEE", spent: points, damageBonus: points }
    });
    return;
  }
  const bonus = Math.floor(points / 2);
  if (bonus <= 0) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 的擦弹点数不足 2 点，无法强化射击"
    });
    return;
  }
  const spent = bonus * 2;
  actor.grazePoints = points - spent;
  actor.grazeDamageBonus = (actor.grazeDamageBonus ?? 0) + bonus;
  actor.grazeDamageBonusKind = "RANGED";
  pushLog(state, {
    kind: "STATUS",
    actorId: actor.id,
    targetId: null,
    text: actor.name + " 消费擦弹 " + spent + " 点，下次远程伤害 +" + bonus + "（剩余擦弹 " + actor.grazePoints + "）",
    data: { rollType: "GRAZE_SPEND_RANGED", spent, damageBonus: bonus, grazePoints: actor.grazePoints }
  });
}

// ================= DP（Dice Pool）行动结算 =================

/** 读取规则包常量；非正数 / 缺失时回退。 */
function dpConst(pack: CompiledRulePack, key: string, fallback: number): number {
  const value = pack.pack.const[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** COC7 属性 → 千幻抄特性值（房间可通过 ATTR_SCALE 覆盖）。 */
function dpAttribute(pack: CompiledRulePack, participant: CombatParticipantState, key: string): number {
  const scale = dpConst(pack, "ATTR_SCALE", 1);
  const raw = participant.attributes[key as keyof AttributeSet] ?? participant.vars[key] ?? 0;
  return Math.max(0, Math.floor(raw / scale));
}

/** COC7 百分制技能 → 千幻抄技能等级（房间可通过 SKILL_SCALE 覆盖）。 */
function dpSkillLevel(pack: CompiledRulePack, participant: CombatParticipantState, skillId: string): number {
  const scale = dpConst(pack, "SKILL_SCALE", 20);
  const raw = skillValueOf(pack, participant, skillId, participant.attributes.dex);
  return Math.max(0, Math.floor(raw / scale));
}

/** 千幻抄能力类别等级（默认 0）。 */
function dpAbilityLevel(actor: CombatParticipantState, abilityId: string | undefined): number {
  if (abilityId === undefined) return 0;
  const value = actor.abilityLevels?.[abilityId];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * DP 攻击伤害表达式。
 *
 * 千幻抄攻击伤害不是卡面固定值，而是公式：
 * - 射击 / 能力：能力 LvD + 特性值（用武器技能时额外 +〈射击武器〉Lv）；
 * - 追击：能力 Lv÷2 D + 特性值；
 * - 近战：{身体} + 锻炼 LvD + 武器 Lv。
 *
 * 服务端在 submission 里写入 `damageAbilityId` / `damageTrainingId` / `damageWeaponSkill`
 * 即启用公式；未提供时回退到卡面 `damage`（兼容旧数据 / 非能力武器）。
 */
function dpAttackDamageExpression(
  pack: CompiledRulePack,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  kind: "RANGED" | "CHASE" | "MELEE"
): string {
  if (kind === "MELEE" && submission.damageTrainingId !== undefined) {
    // 近战「武器 Lv」默认取本次命中使用的武器技能；未提供任何技能时按 0。
    const weaponSkillId = submission.damageWeaponSkill ?? submission.skill;
    const weaponLevel = weaponSkillId === undefined ? 0 : dpSkillLevel(pack, actor, weaponSkillId);
    const body = dpAttribute(pack, actor, "str");
    return touhouMeleeDamage(body, dpAbilityLevel(actor, submission.damageTrainingId), weaponLevel).expression;
  }
  const weaponLevel = submission.damageWeaponSkill === undefined
    ? 0
    : dpSkillLevel(pack, actor, submission.damageWeaponSkill);
  if ((kind === "RANGED" || kind === "CHASE") && submission.damageAbilityId !== undefined) {
    const attributeKey = submission.dpAttribute ?? (kind === "RANGED" ? "dex" : "dex");
    const attribute = dpAttribute(pack, actor, attributeKey);
    const level = dpAbilityLevel(actor, submission.damageAbilityId);
    return kind === "CHASE"
      ? touhouChaseDamage(attribute, level).expression
      : touhouRangedDamage(attribute, level, weaponLevel).expression;
  }
  return submission.damage ?? "1d6";
}

interface DpRoll {
  readonly dice: number;
  readonly roll: number;
  readonly attribute: number;
  readonly skill: number;
  readonly base: number;
  readonly achievement: number;
}

/** 千幻抄判定：{特性值} + 〈技能〉Lv + N D6。 */
function dpRoll(
  pack: CompiledRulePack,
  state: CombatState,
  participant: CombatParticipantState,
  attributeKey: string,
  skillId: string,
  dice: number,
  salt: string
): DpRoll {
  const count = Math.max(0, Math.floor(Number.isFinite(dice) ? dice : 0));
  const attribute = dpAttribute(pack, participant, attributeKey);
  const skill = dpSkillLevel(pack, participant, skillId);
  const base = attribute + skill;
  let roll = 0;
  if (count > 0) {
    try {
      roll = rollDice(parseDice(count + "d6"), nextRollRng(state, salt)).total;
    } catch {
      roll = 0;
    }
  }
  return { dice: count, roll, attribute, skill, base, achievement: base + roll };
}

/** 常时被动的战斗加值（缺省 0）。 */
function passiveBonus(
  participant: CombatParticipantState,
  key: keyof CombatPassiveMods
): number {
  const value = participant.passiveMods?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 消耗 DP；不足时记录日志并返回 false。 */
function spendDp(
  ctx: ResolveContext,
  participant: CombatParticipantState,
  amount: number,
  label: string
): boolean {
  const cost = Math.max(0, Math.floor(amount));
  if (cost <= 0) return true;
  if (participant.dp < cost) {
    pushLog(ctx.state, {
      kind: "SYSTEM",
      actorId: participant.id,
      targetId: null,
      text: participant.name + " 的 DP 不足（需要 " + cost + "，当前 " + participant.dp + "）",
      data: { rollType: "DP_INSUFFICIENT", required: cost, dp: participant.dp, label }
    });
    return false;
  }
  participant.dp -= cost;
  pushLog(ctx.state, {
    kind: "ACTION",
    actorId: participant.id,
    targetId: null,
    text: participant.name + " 消耗 " + cost + " DP（" + label + "，剩余 " + participant.dp + "）",
    data: { rollType: "DP_SPEND", cost, dp: participant.dp, label }
  });
  return true;
}

/** DP 防御应对：回避（{感觉}+〈回避〉）/ 防御（{身体}+〈近战武器〉）。 */
function resolveDpDefense(
  ctx: ResolveContext,
  defender: CombatParticipantState,
  reaction: DefenseReaction,
  attackAchievement: number
): { readonly success: boolean; readonly reduction: number } {
  const costs = ctx.pack.pack.dp.actionCosts;
  const dice = Math.max(1, Math.floor(reaction.dpDice ?? 1));
  if (reaction.type === "DEFEND") {
    const perDie = Math.max(0, Math.floor(costs.defendPerDie));
    if (spendDp(ctx, defender, perDie * dice, "防御 " + dice + "D") === false) {
      return { success: false, reduction: 0 };
    }
    const roll = dpRoll(ctx.pack, ctx.state, defender, "str", reaction.skill ?? "MELEE", dice, "dp-defend:" + defender.id);
    const reactionAchievement = roll.achievement + passiveBonus(defender, "reactionBonus");
    const success = reactionAchievement >= attackAchievement;
    const reduction = success ? 0 : dpSkillLevel(ctx.pack, defender, reaction.skill ?? "MELEE") * 2;
    pushLog(ctx.state, {
      kind: "CHECK",
      actorId: defender.id,
      targetId: null,
      text:
        defender.name + " 防御（DP）：" + dice + "d6=" + roll.roll + " + " + roll.base + " = " + reactionAchievement +
        " / 攻击达成 " + attackAchievement + " → " + (success ? "防御成功" : "防御失败，减伤 " + reduction),
      data: { rollType: "DP_DEFEND", dice, roll: roll.roll, base: roll.base, achievement: reactionAchievement, attackAchievement, success, reduction }
    });
    return { success, reduction };
  }
  // 默认回避：对射击 / 追击 / 近战可用
  const perDie = Math.max(0, Math.floor(costs.dodgePerDie));
  if (spendDp(ctx, defender, perDie * dice, "回避 " + dice + "D") === false) {
    return { success: false, reduction: 0 };
  }
  const roll = dpRoll(ctx.pack, ctx.state, defender, "dex", reaction.skill ?? "DODGE", dice, "dp-dodge:" + defender.id);
  const reactionAchievement = roll.achievement + passiveBonus(defender, "reactionBonus");
  const success = reactionAchievement >= attackAchievement;
  let grazeGain = 0;
  if (success && ctx.pack.system === "TOUHOU") {
    // 千幻抄 6.26：成功回避射击 / 追击 / 近战可获得擦弹点数（防御不能）。
    grazeGain = Math.max(1, dice);
    defender.grazePoints = Math.max(0, Math.floor(defender.grazePoints ?? 0)) + grazeGain;
  }
  pushLog(ctx.state, {
    kind: "CHECK",
    actorId: defender.id,
    targetId: null,
    text:
      defender.name + " 回避（DP）：" + dice + "d6=" + roll.roll + " + " + roll.base + " = " + reactionAchievement +
      " / 攻击达成 " + attackAchievement + " → " + (success ? "回避成功" : "回避失败") +
      (grazeGain > 0 ? "，擦弹 +" + grazeGain : ""),
    data: { rollType: "DP_DODGE", dice, roll: roll.roll, base: roll.base, achievement: reactionAchievement, attackAchievement, success, grazeGain }
  });
  return { success, reduction: 0 };
}

interface DpCoverOutcome {
  readonly target: CombatParticipantState;
  readonly reduction: number;
}

/**
 * DP 掩护 / 身代：队友声明 COVER 并指定 coverTargetId。
 *
 * {感觉}+〈回避〉+ND6 对抗攻击达成值：成功由掩护者代替承受伤害，失败则原目标无减伤承受。
 * 同一掩护者一轮只能掩护一次（前卫规则由 KP / 后续位置模型约束）；DP 不足则无法掩护。
 */
function resolveDpCover(
  ctx: ResolveContext,
  attacker: CombatParticipantState,
  target: CombatParticipantState,
  attackAchievement: number,
  salt: string
): DpCoverOutcome | null {
  const state = ctx.state;
  if (state.mode !== "DP") return null;
  const costs = ctx.pack.pack.dp.actionCosts;
  const perDie = Math.max(0, Math.floor(costs.coverPerDie));
  const maxDice = ctx.pack.pack.dp.maxDicePerCheck;
  for (const [covererId, reaction] of Object.entries(ctx.reactions)) {
    if (reaction.type !== "COVER" || reaction.coverTargetId !== target.id) continue;
    const coverer = findParticipant(state, covererId);
    if (coverer === undefined || coverer.defeated || coverer.id === target.id) continue;
    if (coverer.faction !== target.faction) continue;
    if (coverer.coverUsedThisRound === true) continue;
    const dice = clampTouhouDpDice(reaction.dpDice ?? 1, maxDice);
    if (spendDp(ctx, coverer, perDie * dice, "掩护 " + dice + "D") === false) continue;
    coverer.coverUsedThisRound = true;
    const roll = dpRoll(ctx.pack, state, coverer, "dex", reaction.skill ?? "DODGE", dice, salt + ":" + coverer.id);
    const reactionAchievement = roll.achievement + passiveBonus(coverer, "reactionBonus");
    const success = reactionAchievement >= attackAchievement;
    pushLog(state, {
      kind: "CHECK",
      actorId: coverer.id,
      targetId: attacker.id,
      text:
        coverer.name + " 掩护 " + target.name + "：" + dice + "d6=" + roll.roll + " + " + roll.base + " = " + reactionAchievement +
        " / 攻击达成 " + attackAchievement + " → " + (success ? "代替承受伤害" : "掩护失败，原目标无减伤承受"),
      data: {
        rollType: "DP_COVER",
        dice,
        roll: roll.roll,
        base: roll.base,
        achievement: reactionAchievement,
        attackAchievement,
        success,
        coverTargetId: target.id,
        attackerId: attacker.id
      }
    });
    return success ? { target: coverer, reduction: 0 } : { target, reduction: 0 };
  }
  return null;
}

/** DP 射击：消费判定骰 DP，{特性值}+〈射击/射击武器〉+N D6 对抗目标应对。 */
function resolveDpRangedAttack(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  defender: CombatParticipantState
): void {
  const state = ctx.state;
  const costs = ctx.pack.pack.dp.actionCosts;
  const dice = Math.max(1, Math.floor(submission.dpDice ?? 1));
  const perDie = Math.max(0, Math.floor(costs.rangedPerDie));
  if (spendDp(ctx, actor, perDie * dice, "射击 " + dice + "D") === false) return;
  const skillId = submission.skill ?? "DANMAKU";
  const attributeKey = submission.dpAttribute ?? "dex";
  const attack = dpRoll(ctx.pack, state, actor, attributeKey, skillId, dice, "dp-ranged:" + actor.id + ":" + defender.id);
  const enhance = spellcardEnhanceForAttack(ctx.pack, actor, skillId);
  const attackAchievement = attack.achievement + (enhance?.accuracyMod ?? 0) + passiveBonus(actor, "accuracyBonus");
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text:
      actor.name + " 射击（DP）：" + dice + "d6=" + attack.roll + " + " + attack.base + " = " + attackAchievement +
      (enhance === null ? "" : "（符卡强化）"),
    data: { rollType: "DP_RANGED_ATTACK", dice, roll: attack.roll, base: attack.base, achievement: attackAchievement, skill: skillId, attribute: attributeKey, enhanceAccuracy: enhance?.accuracyMod ?? 0 }
  });
  const cover = resolveDpCover(ctx, actor, defender, attackAchievement, "dp-ranged-cover:" + actor.id + ":" + defender.id);
  let damageTarget = defender;
  let reduction = 0;
  if (cover === null) {
    const reaction = reactionFor(ctx, defender.id);
    const defense = resolveDpDefense(ctx, defender, reaction, attackAchievement);
    if (defense.success) {
      pushLog(state, {
        kind: "ACTION",
        actorId: actor.id,
        targetId: defender.id,
        text: defender.name + " 成功应对，「" + (submission.name ?? skillId) + "」未命中",
        data: { rollType: "DP_RANGED_MISS", defense: reaction.type }
      });
      return;
    }
    reduction = defense.reduction;
  } else {
    damageTarget = cover.target;
  }
  const damageExpression = expandDamageBonus(
    dpAttackDamageExpression(ctx.pack, actor, submission, "RANGED"),
    actor.damageBonus
  );
  let rolled = 0;
  try {
    rolled = Math.max(0, rollDice(parseDice(damageExpression), nextRollRng(state, "dp-ranged-damage:" + actor.id + ":" + defender.id)).total);
  } catch {
    rolled = 0;
  }
  const enhancedRoll = Math.round((rolled + (enhance?.flatDamage ?? 0) + passiveBonus(actor, "damageBonus")) * (enhance?.damageMultiplier ?? 1));
  const total = Math.max(0, enhancedRoll - reduction);
  const armorResult = absorbWithArmor(damageTarget, total);
  const applied = applyDamageToParticipant(ctx, damageTarget, armorResult.remaining, actor);
  pushLog(state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: damageTarget.id,
    text:
      "射击伤害：" + damageTarget.name + " 受到 " + total + "（" + damageExpression + " = " + rolled +
      ((enhance?.flatDamage ?? 0) > 0 ? "，符卡强化 +" + enhance?.flatDamage : "") +
      (reduction > 0 ? "，防御减伤 " + reduction : "") +
      (armorResult.absorbed > 0 ? "，护甲吸收 " + armorResult.absorbed : "") +
      "）→ HP 结算 " + Math.max(0, total - armorResult.absorbed),
    data: { rollType: "DP_RANGED_DAMAGE", expression: damageExpression, roll: rolled, enhanceFlat: enhance?.flatDamage ?? 0, reduction, damage: total, armorAbsorbed: armorResult.absorbed, covered: cover !== null && damageTarget.id !== defender.id, toDeclaration: applied.toDeclaration, toHp: applied.toHp }
  });
}

/** 结算一次普通伤害表达式（伤害骰不消耗 DP）。 */
function rollDpDamage(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  expression: string,
  salt: string
): number {
  try {
    return Math.max(0, rollDice(parseDice(expandDamageBonus(expression, actor.damageBonus)), nextRollRng(ctx.state, salt)).total + passiveBonus(actor, "damageBonus"));
  } catch {
    return 0;
  }
}

/** 把一次已确定的伤害应用到目标（含护甲），并写日志。 */
function applyDpDamage(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  target: CombatParticipantState,
  amount: number,
  label: string,
  reduction = 0,
  expression?: string
): void {
  const total = Math.max(0, amount - Math.max(0, reduction));
  const armorResult = absorbWithArmor(target, total);
  const applied = applyDamageToParticipant(ctx, target, armorResult.remaining, actor);
  pushLog(ctx.state, {
    kind: "DAMAGE",
    actorId: actor.id,
    targetId: target.id,
    text:
      label + "：" + target.name + " 受到 " + total +
      (reduction > 0 ? "（原 " + amount + "，应对减伤 " + reduction + "）" : "") +
      (armorResult.absorbed > 0 ? "，护甲吸收 " + armorResult.absorbed : "") +
      " → HP 结算 " + Math.max(0, total - armorResult.absorbed),
    data: { rollType: "DP_DAMAGE", amount, reduction, damage: total, armorAbsorbed: armorResult.absorbed, expression: expression ?? "", toDeclaration: applied.toDeclaration, toHp: applied.toHp }
  });
}

/**
 * DP 追击：消费「每目标 2 DP」，不进行命中判定，达成值固定 {特性值}+〈追击〉+10；
 * 目标仍可回避 / 防御。伤害骰只掷一次，命中目标受到相同伤害。
 */
function resolveDpChase(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const costs = ctx.pack.pack.dp.actionCosts;
  const targetIds = (submission.dpTargetIds ?? (submission.targetId === null || submission.targetId === undefined ? [] : [submission.targetId]))
    .filter((id, index, list) => list.indexOf(id) === index);
  if (targetIds.length === 0) {
    pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: actor.name + " 的追击没有目标" });
    return;
  }
  const skillId = submission.skill ?? "DANMAKU";
  const skillLevel = dpSkillLevel(ctx.pack, actor, skillId);
  const maxTargets = Math.ceil(skillLevel / 2) + 1;
  const targets = targetIds
    .map((id) => findParticipant(state, id))
    .filter((item): item is CombatParticipantState => item !== undefined && item.defeated === false)
    .slice(0, maxTargets);
  if (targets.length === 0) {
    pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: actor.name + " 的追击目标已不在场" });
    return;
  }
  const perTarget = Math.max(0, Math.floor(costs.chasePerTarget));
  if (spendDp(ctx, actor, perTarget * targets.length, "追击 ×" + targets.length) === false) return;
  const attributeKey = submission.dpAttribute ?? "dex";
  const base = dpAttribute(ctx.pack, actor, attributeKey) + skillLevel + 10;
  const escalation = Math.max(0, Math.floor(submission.dpEscalation ?? 0));
  const maxEscalation = Math.floor(skillLevel / 4);
  const extraDp = Math.min(escalation, maxEscalation) * 2;
  if (extraDp > 0 && spendDp(ctx, actor, extraDp, "追击强化 +" + Math.min(escalation, maxEscalation) * 10) === false) return;
  const chaseEnhance = spellcardEnhanceForAttack(ctx.pack, actor, skillId);
  const achievement =
    base + Math.min(escalation, maxEscalation) * 10 + (chaseEnhance?.accuracyMod ?? 0);
  const damageExpression = dpAttackDamageExpression(ctx.pack, actor, submission, "CHASE");
  const rolledChaseDamage = rollDpDamage(ctx, actor, damageExpression, "dp-chase-damage:" + actor.id + ":" + state.round);
  const damage = Math.round(
    (rolledChaseDamage + (chaseEnhance?.flatDamage ?? 0)) * (chaseEnhance?.damageMultiplier ?? 1)
  );
  const hits: { target: CombatParticipantState; label: string }[] = [];
  for (const target of targets) {
    const cover = resolveDpCover(ctx, actor, target, achievement, "dp-chase-cover:" + actor.id + ":" + target.id);
    if (cover !== null) {
      hits.push({
        target: cover.target,
        label: cover.target.id === target.id ? "追击命中（掩护失败，无减伤）" : "追击命中（" + cover.target.name + " 掩护 " + target.name + "）"
      });
      continue;
    }
    const reaction = reactionFor(ctx, target.id);
    const defense = resolveDpDefense(ctx, target, reaction, achievement);
    if (defense.success === false) {
      hits.push({ target, label: "追击命中（达成值 " + achievement + "）" });
    }
  }
  if (hits.length === 0) {
    pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: actor.name + " 的追击被全部应对" });
    return;
  }
  for (const hit of hits) {
    applyDpDamage(ctx, actor, hit.target, damage, hit.label, 0, damageExpression);
  }
}

/**
 * DP 近战：先做接近判定（{身体}+〈回避〉 vs 目标 {身体}+max(〈回避〉,〈弹幕〉+15)），
 * 成功后再做命中判定（{身体}+〈近战武器〉）；接近与命中各自消费 DP 骰。
 */
function resolveDpMelee(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission,
  defender: CombatParticipantState
): void {
  const state = ctx.state;
  const costs = ctx.pack.pack.dp.actionCosts;
  const approachDice = Math.max(1, Math.floor(submission.dpDice ?? 1));
  const hitDice = Math.max(1, Math.floor(submission.dpSecondaryDice ?? 1));
  const approachCost = Math.max(0, Math.floor(costs.meleeApproachPerDie)) * approachDice;
  const hitCost = Math.max(0, Math.floor(costs.meleeHitPerDie)) * hitDice;
  if (spendDp(ctx, actor, approachCost + hitCost, "接近 " + approachDice + "D + 命中 " + hitDice + "D") === false) return;

  const meleeEnhance = spellcardEnhanceForAttack(ctx.pack, actor, submission.skill ?? "MELEE");
  const approach = dpRoll(ctx.pack, state, actor, "str", "DODGE", approachDice, "dp-melee-approach:" + actor.id + ":" + defender.id);
  const approachAchievement = approach.achievement + (meleeEnhance?.accuracyMod ?? 0) + passiveBonus(actor, "accuracyBonus");
  const defenderAvoid = dpSkillLevel(ctx.pack, defender, "DODGE");
  const defenderDanmaku = dpSkillLevel(ctx.pack, defender, "DANMAKU");
  const approachTarget = dpAttribute(ctx.pack, defender, "str") + Math.max(defenderAvoid, defenderDanmaku + 15);
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text:
      actor.name + " 接近判定：" + approachDice + "d6=" + approach.roll + " + " + approach.base + " = " + approachAchievement +
      (meleeEnhance === null ? "" : "（符卡强化）") +
      " / 目标 " + approachTarget + " → " + (approachAchievement >= approachTarget ? "接近成功" : "接近失败"),
    data: { rollType: "DP_MELEE_APPROACH", dice: approachDice, roll: approach.roll, base: approach.base, achievement: approachAchievement, target: approachTarget, enhanceAccuracy: meleeEnhance?.accuracyMod ?? 0, success: approachAchievement >= approachTarget }
  });
  if (approachAchievement < approachTarget) return;

  const hit = dpRoll(ctx.pack, state, actor, "str", submission.skill ?? "MELEE", hitDice, "dp-melee-hit:" + actor.id + ":" + defender.id);
  const hitAchievement = hit.achievement + passiveBonus(actor, "accuracyBonus");
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: defender.id,
    text: actor.name + " 近战命中：" + hitDice + "d6=" + hit.roll + " + " + hit.base + " = " + hitAchievement,
    data: { rollType: "DP_MELEE_HIT", dice: hitDice, roll: hit.roll, base: hit.base, achievement: hitAchievement }
  });
  const cover = resolveDpCover(ctx, actor, defender, hitAchievement, "dp-melee-cover:" + actor.id + ":" + defender.id);
  let damageTarget = defender;
  let reduction = 0;
  if (cover === null) {
    const reaction = reactionFor(ctx, defender.id);
    const defense = resolveDpDefense(ctx, defender, reaction, hitAchievement);
    if (defense.success) {
      pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: defender.id, text: defender.name + " 成功应对近战攻击" });
      return;
    }
    reduction = defense.reduction;
  } else {
    damageTarget = cover.target;
  }
  const damageExpression = dpAttackDamageExpression(ctx.pack, actor, submission, "MELEE");
  const rolledMeleeDamage = rollDpDamage(ctx, actor, damageExpression, "dp-melee-damage:" + actor.id + ":" + defender.id);
  const damage = Math.round(rolledMeleeDamage * (meleeEnhance?.damageMultiplier ?? 1));
  const hitLabel = cover !== null && damageTarget.id !== defender.id
    ? "近战命中（" + damageTarget.name + " 掩护 " + defender.name + "）"
    : "近战命中";
  applyDpDamage(ctx, actor, damageTarget, damage, hitLabel, reduction, damageExpression);
}

/**
 * DP 其他行动（千幻抄 6.18）：调查 / 感知等也可判定，
 * 最多消费 maxDicePerCheck 颗骰，也可选择不判定（直接 PASS）。
 */
function resolveDpSkillCheck(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const dpRules = ctx.pack.pack.dp;
  const perDie = Math.max(0, Math.floor(dpRules.actionCosts.abilityPerDie));
  const dice = clampTouhouDpDice(submission.dpDice ?? 1, dpRules.maxDicePerCheck);
  if (spendDp(ctx, actor, perDie * dice, "其他判定 " + dice + "D") === false) return;
  const skillId = submission.skill ?? "DANMAKU";
  const attributeKey = submission.dpAttribute ?? "int";
  const target = Math.max(0, Math.floor(submission.dpTargetValue ?? 12));
  const roll = dpRoll(ctx.pack, state, actor, attributeKey, skillId, dice, "dp-skill:" + actor.id + ":" + skillId);
  const success = roll.achievement >= target;
  pushLog(state, {
    kind: "CHECK",
    actorId: actor.id,
    targetId: submission.targetId ?? null,
    text:
      actor.name + " 其他判定〈" + skillId + "〉：" + dice + "d6=" + roll.roll + " + " + roll.base + " = " +
      roll.achievement + " / 目标 " + target + " → " + (success ? "成功" : "失败"),
    data: {
      rollType: "DP_SKILL_CHECK",
      dice,
      roll: roll.roll,
      base: roll.base,
      achievement: roll.achievement,
      target,
      success,
      skill: skillId,
      attribute: attributeKey
    }
  });
}

/**
 * DP 弹幕：固定 DP 消耗、无判定、影响全体敌人。
 * 目标选择「回避弹幕」时消耗规定 DP，不受伤；DP 不足则受到固定伤害。
 */
function resolveDpDanmaku(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const cost = Math.max(0, Math.floor(ctx.pack.pack.dp.actionCosts.danmaku));
  if (spendDp(ctx, actor, cost, "弹幕") === false) return;
  const reduction = Math.max(0, Math.floor(submission.danmakuDpReduction ?? 1));
  const danmakuEnhance = spellcardEnhanceForAttack(ctx.pack, actor, "DANMAKU");
  const baseDamage = Math.max(
    0,
    Math.round(
      (Math.max(0, Math.floor(submission.danmakuBaseDamage ?? 1)) + (danmakuEnhance?.flatDamage ?? 0)) *
        (danmakuEnhance?.damageMultiplier ?? 1)
    )
  );
  const targets = state.participants.filter(
    (participant) => participant.defeated === false && participant.faction !== actor.faction
  );
  if (targets.length === 0) {
    pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: actor.name + " 的弹幕没有目标" });
    return;
  }
  for (const target of targets) {
    const reaction = reactionFor(ctx, target.id);
    if (reaction.type === "DODGE" && target.dp >= reduction) {
      target.dp -= reduction;
      if (ctx.pack.system === "TOUHOU") {
        target.grazePoints = Math.max(0, Math.floor(target.grazePoints ?? 0)) + 1;
      }
      pushLog(state, {
        kind: "STATUS",
        actorId: actor.id,
        targetId: target.id,
        text: target.name + " 回避弹幕，DP -" + reduction + "（剩余 " + target.dp + "），擦弹 +1",
        data: { rollType: "DP_DANMAKU_DODGE", reduction, dp: target.dp, grazePoints: target.grazePoints ?? 0 }
      });
      continue;
    }
    const applied = applyDamageToParticipant(ctx, target, baseDamage, actor);
    pushLog(state, {
      kind: "DAMAGE",
      actorId: actor.id,
      targetId: target.id,
      text:
        target.name +
        (reaction.type === "DODGE" ? " 的 DP 不足以回避弹幕" : " 未回避弹幕") +
        "，受到固定伤害 " + baseDamage,
      data: { rollType: "DP_DANMAKU_HIT", damage: baseDamage, toDeclaration: applied.toDeclaration, toHp: applied.toHp }
    });
  }
}

/**
 * 结算当前 DP 行动者的一项行动（不含回合推进，由 dp.ts 调用）。
 * 本批已实现弹幕；其余行动暂时回落到通用 resolveOne，后续补射击/追击/近战/能力。
 */
export function resolveDpActionForActor(
  pack: CompiledRulePack,
  state: CombatState,
  reactions: Readonly<Record<string, DefenseReaction>>,
  actorId: string
): ResolveResult {
  const actor = findParticipant(state, actorId);
  const submission = state.pending[actorId];
  if (actor === undefined || actor.defeated || submission === undefined) {
    delete state.pending[actorId];
    return { acted: [], defeated: [], cleared: [] };
  }
  const ctx: ResolveContext = {
    pack,
    state,
    reactions,
    queue: [],
    cancelled: new Set<string>(),
    coverCache: new Map()
  };
  const acted: string[] = [];
  // 千幻抄 6.21：待机（不进行攻击行动）下一回合 DP 回复 +2。
  if (
    submission.kind === "PASS" &&
    submission.grazeSpend === undefined &&
    submission.abandonDeclaration !== true &&
    state.dp !== null &&
    state.dp !== undefined
  ) {
    state.dp.regenBonus[actor.id] = (state.dp.regenBonus[actor.id] ?? 0) + 2;
    pushLog(state, {
      kind: "STATUS",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 待机，下回合 DP 回复 +2",
      data: { rollType: "DP_WAIT", regenBonus: state.dp.regenBonus[actor.id] ?? 0 }
    });
  }
  if (submission.kind === "DANMAKU" && submission.dpAction === "DANMAKU") {
    resolveDpDanmaku(ctx, actor, submission);
  } else if (submission.kind === "DANMAKU" && submission.dpAction === "RANGED") {
    const defender = submission.targetId === null || submission.targetId === undefined
      ? undefined
      : findParticipant(state, submission.targetId);
    if (defender === undefined || defender.defeated) {
      pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: submission.targetId ?? null, text: actor.name + " 的射击目标已不在场" });
    } else {
      resolveDpRangedAttack(ctx, actor, submission, defender);
    }
  } else if (submission.kind === "DANMAKU" && submission.dpAction === "CHASE") {
    resolveDpChase(ctx, actor, submission);
  } else if (submission.kind === "DANMAKU" && submission.dpAction === "SKILL") {
    resolveDpSkillCheck(ctx, actor, submission);
  } else if (submission.kind === "DANMAKU" && submission.dpAction === "MELEE") {
    const defender = submission.targetId === null || submission.targetId === undefined
      ? undefined
      : findParticipant(state, submission.targetId);
    if (defender === undefined || defender.defeated) {
      pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: submission.targetId ?? null, text: actor.name + " 的近战目标已不在场" });
    } else {
      resolveDpMelee(ctx, actor, submission, defender);
    }
  } else {
    resolveOne(ctx, actor, submission);
  }
  acted.push(actor.id);
  delete state.pending[actorId];
  return {
    acted,
    defeated: state.participants.filter((participant) => participant.defeated).map((participant) => participant.id),
    cleared: [...ctx.cancelled]
  };
}

function resolveOne(
  ctx: ResolveContext,
  actor: CombatParticipantState,
  submission: ActionSubmission
): void {
  const state = ctx.state;
  const targetId = submission.targetId ?? null;

  switch (submission.kind) {
    case "MAGIC": {
      const spell = findMagicSpell(ctx.pack, submission);
      if (
        ctx.pack.system === "TOUHOU" &&
        spell?.abilityId !== undefined &&
        ctx.pack.pack.abilities.enabled
      ) {
        resolveAbility(ctx, actor, submission, spell);
      } else {
        resolveMagic(ctx, actor, submission);
      }
      return;
    }
    case "OUT_OF_RULE":
      resolveOutOfRule(ctx, actor, submission);
      return;
    case "PASS": {
      if (submission.abandonDeclaration === true) {
        abandonSpellcard(ctx, actor);
        return;
      }
      if (submission.grazeSpend !== undefined) {
        resolveGrazeSpend(ctx, actor, submission.grazeSpend);
        return;
      }
      pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: `${actor.name} 跳过本回合` });
      return;
    }
    case "FLEE":
      actor.defeated = true;
      actor.isReady = false;
      pushLog(state, { kind: "DEFEAT", actorId: actor.id, targetId: null, text: `${actor.name} 脱离了战斗` });
      return;
    case "MANEUVER": {
      if (targetId === null) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: `${actor.name} 的战技没有目标` });
        return;
      }
      const defender = findParticipant(state, targetId);
      if (defender === undefined || defender.defeated) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId, text: `${actor.name} 的战技目标已不在场` });
        return;
      }
      resolveManeuver(ctx, actor, submission, defender);
      return;
    }
    case "ITEM": {
      if (submission.effects !== undefined && submission.effects.length > 0) {
        resolveItem(ctx, actor, submission);
        return;
      }
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
      // U-3：多目标 / 多技能 routine：按步骤逐条结算，每步可换技能 / 目标 / 连射。
      if (submission.routine !== undefined && submission.routine.length > 0) {
        for (const step of submission.routine) {
          if (actor.defeated) break;
          const stepTarget = findParticipant(state, step.targetId);
          if (stepTarget === undefined || stepTarget.defeated) {
            pushLog(state, {
              kind: "ACTION",
              actorId: actor.id,
              targetId: step.targetId,
              text: actor.name + " 的攻击目标已不在场"
            });
            continue;
          }
          const stepSkill = step.skill ?? submission.skill;
          const shotCount = Math.max(1, Math.min(3, Math.floor(step.shots ?? 1)));
          for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
            if (actor.defeated || stepTarget.defeated) break;
            resolveAttack(
              ctx,
              actor,
              {
                actorId: actor.id,
                kind: "DANMAKU",
                targetId: step.targetId,
                skill: stepSkill,
                damage: step.damage ?? submission.damage,
                damageType: step.damageType ?? submission.damageType,
                element: step.element ?? submission.element,
                accuracyMod: step.accuracyMod,
                bonusDice: step.bonusDice,
                bonusDiceSource: step.bonusDiceSource,
                penaltyDice: (step.penaltyDice ?? 0) + (shotCount > 1 ? 1 : 0),
                shotIndex,
                shotCount
              },
              stepTarget
            );
          }
        }
        return;
      }
      if (targetId === null) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId: null, text: `${actor.name} 的弹幕没有目标` });
        return;
      }
      const defender = findParticipant(state, targetId);
      if (defender === undefined || defender.defeated) {
        pushLog(state, { kind: "ACTION", actorId: actor.id, targetId, text: `${actor.name} 的目标已不在场` });
        return;
      }
      const shotCount = Math.max(1, Math.min(3, Math.floor(submission.shots ?? 1)));
      for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
        if (actor.defeated || defender.defeated) break;
        resolveAttack(
          ctx,
          actor,
          {
            ...submission,
            shots: undefined,
            penaltyDice: (submission.penaltyDice ?? 0) + (shotCount > 1 ? 1 : 0),
            shotIndex,
            shotCount
          },
          defender
        );
      }
      return;
    }
  }
}

/**
 * 立即结算单个行动，不依赖 ATB / 先攻队列。
 *
 * 用于追逐战中的「行动点动作」：同地点攻击仍然走完整的
 * 攻击检定 / 闪避 / 反击 / 伤害管线，但不需要等待先攻轮转。
 */
export function resolveImmediateAction(
  pack: CompiledRulePack,
  state: CombatState,
  action: ActionSubmission,
  reactions: Readonly<Record<string, DefenseReaction>> = {}
): ResolveResult {
  const actor = findParticipant(state, action.actorId);
  if (state.phase === "ENDED" || actor === undefined || actor.defeated) {
    return {
      acted: [],
      defeated: state.participants.filter((item) => item.defeated).map((item) => item.id),
      cleared: []
    };
  }
  const ctx: ResolveContext = {
    pack,
    state,
    reactions,
    queue: [action],
    cancelled: new Set<string>(),
    coverCache: new Map()
  };
  const acted: string[] = [];
  while (ctx.queue.length > 0) {
    const next = ctx.queue.shift() as ActionSubmission;
    const who = findParticipant(state, next.actorId);
    if (who === undefined || who.defeated) continue;
    if (ctx.cancelled.has(next.actorId)) {
      pushLog(state, {
        kind: "SYSTEM",
        actorId: who.id,
        targetId: null,
        text: who.name + " 的弹幕被清除"
      });
      continue;
    }
    acted.push(who.id);
    resolveOne(ctx, who, next);
  }
  return {
    acted,
    defeated: state.participants.filter((item) => item.defeated).map((item) => item.id),
    cleared: [...ctx.cancelled]
  };
}

/** 一方全灭（或只剩单一阵营）即结束。 */
export interface SpellcardBattleSideSummary {
  /** 阵营 key（ALLY / ENEMY 或自定义）。 */
  readonly side: string;
  /** 本场该方可用 SC 总数。 */
  readonly usable: number;
  /** 该方已使用 SC 数（跨成员合计）。 */
  readonly used: number;
  /** 剩余可用 SC 数。 */
  readonly remaining: number;
  /** 该方未退场人数。 */
  readonly alive: number;
}

/**
 * 符卡战余量：按 4.16「没有可用 SC 且 HP 为 0」给出每一方的可用 SC 与存活人数，
 * 供 KP 判断是否击坠。非符卡战（没有 declaredCardIds）返回 null。
 */
export function spellcardBattleSummary(state: CombatState): SpellcardBattleSideSummary[] | null {
  const battle = state.spellcardBattle;
  if (battle === null || battle === undefined || battle.declaredCardIds === undefined) return null;
  const sides = new Set(state.participants.map((participant) => participant.faction ?? "ALLY"));
  const output: SpellcardBattleSideSummary[] = [];
  for (const side of sides) {
    const members = state.participants.filter((participant) => (participant.faction ?? "ALLY") === side);
    const usable = Math.max(0, Math.floor(battle.sideUsable[side] ?? 0));
    const used = members.reduce((sum, participant) => sum + participant.usedSpellCards.length, 0);
    output.push({
      side,
      usable,
      used,
      remaining: Math.max(0, usable - used),
      alive: members.filter((participant) => participant.defeated === false).length
    });
  }
  return output;
}

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

  const ctx: ResolveContext = {
    pack,
    state,
    reactions,
    queue,
    cancelled: new Set<string>(),
    coverCache: new Map()
  };
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
    const costKind =
      kind === "OUT_OF_RULE" || kind === "MAGIC"
        ? "SPELLCARD"
        : kind === "MANEUVER"
          ? "DANMAKU"
          : kind;
    const cost = submission?.atbCost ?? resolveActionCost(pack, costKind, participant.vars);
    consumeAction(participant, cost);
  }

  state.round += 1;
  resolveRoundRaceAbilities(pack, state);
  for (const participant of state.participants) {
    participant.reactionsThisRound = 0;
    participant.coverUsedThisRound = false;
    participant.abilityUsedThisRound = false;
  }
  resolveRoundEndDotDamage(pack, state);
  expireRoundTimers(state);
  resolveDyingChecks(pack, state);
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
    return { id: item.id, score: score + (item.initiativeMod ?? 0) };
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
  for (const participant of state.participants) {
    participant.reactionsThisRound = 0;
    participant.coverUsedThisRound = false;
    participant.abilityUsedThisRound = false;
  }
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
    resolveRoundRaceAbilities(pack, state);
    resolveRoundEndDotDamage(pack, state);
    expireRoundTimers(state);
    resolveDyingChecks(pack, state);
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
    cancelled: new Set<string>(),
    coverCache: new Map()
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
