import { evaluate, type EvalContext } from "@touhou/formula";
import type { CompiledRulePack } from "./compile";
import type { ActionCostKey } from "./schema";

/**
 * ATB 精度。所有进度都乘以 1000 存成整数，避免浮点累积误差 ——
 * 这是「战斗可重放」的前提：同样的计数序列必定得到逐位相同的状态。
 */
export const ATB_SCALE = 1000;

export function toMicro(value: number): number {
  return Math.round(value * ATB_SCALE);
}

export function fromMicro(value: number): number {
  return value / ATB_SCALE;
}

export interface AtbActor {
  readonly id: string;
  /** 当前进度，单位 1/ATB_SCALE。 */
  atbValue: number;
  /** 充满所需进度，单位 1/ATB_SCALE。 */
  atbMax: number;
  /** 每个全局计数推进的进度，单位 1/ATB_SCALE。 */
  speed: number;
  isReady: boolean;
}

export interface ActiveStatusEffect {
  readonly key: string;
  readonly stacks: number;
  /** 剩余多少个全局计数。模拟层只认计数，不认毫秒。 */
  readonly remainingTicks: number;
  /** DOT：每次受影响者进入行动时造成的固定伤害（施加时已掷出）。 */
  readonly dotDamage?: number;
  /** DOT 来源名称，用于战斗日志。 */
  readonly dotSource?: string;
  /** DOT 上次触发时的 tick，防止同一 tick 重复触发。 */
  readonly dotLastTick?: number;
  /** DOT 剩余触发次数（按目标回合数计，而不是全局 tick）。 */
  readonly dotTurns?: number;
}

function contextOf(
  pack: CompiledRulePack,
  vars: Readonly<Record<string, number>>
): EvalContext {
  return { vars, consts: pack.pack.const };
}

export function computeAtbMax(
  pack: CompiledRulePack,
  vars: Readonly<Record<string, number>>
): number {
  return Math.max(1, toMicro(evaluate(pack.atb.max, contextOf(pack, vars))));
}

export function computeBaseSpeed(
  pack: CompiledRulePack,
  vars: Readonly<Record<string, number>>
): number {
  return Math.max(0, toMicro(evaluate(pack.atb.speed, contextOf(pack, vars))));
}

export function resolveActionCost(
  pack: CompiledRulePack,
  action: ActionCostKey,
  vars: Readonly<Record<string, number>>
): number {
  const expression = pack.atb.actionCost[action];
  if (expression === undefined) return 0;
  return Math.max(0, toMicro(evaluate(expression, contextOf(pack, vars))));
}

/**
 * 状态效果对速度的乘算。多个效果之间连乘（与顺序无关），
 * 同一效果的多层按幂次生效。
 */
function multiplierOf(
  pack: CompiledRulePack,
  effects: readonly ActiveStatusEffect[],
  field: "speedMultiplier" | "damageMultiplier",
  vars: Readonly<Record<string, number>>
): number {
  let multiplier = 1;
  for (const effect of effects) {
    const rule = pack.statusEffects[effect.key];
    if (rule === undefined) continue;
    const expression = field === "speedMultiplier" ? rule.speedMultiplier : rule.damageMultiplier;
    if (expression === undefined) continue;
    multiplier *= Math.pow(
      evaluate(expression, contextOf(pack, vars)),
      Math.max(1, effect.stacks)
    );
  }
  return multiplier;
}

export function speedMultiplierOf(
  pack: CompiledRulePack,
  effects: readonly ActiveStatusEffect[],
  vars: Readonly<Record<string, number>>
): number {
  return multiplierOf(pack, effects, "speedMultiplier", vars);
}

export function damageMultiplierOf(
  pack: CompiledRulePack,
  effects: readonly ActiveStatusEffect[],
  vars: Readonly<Record<string, number>>
): number {
  return multiplierOf(pack, effects, "damageMultiplier", vars);
}

/**
 * 全局计数器 +1：所有参与者按各自的 speed 前进一帧。
 * 返回本次计数中新就绪的人（若多人同帧就绪，按进度降序，进度相同则保持传入顺序）。
 */
export function advanceTick(actors: readonly AtbActor[]): AtbActor[] {
  const ready: AtbActor[] = [];
  for (const actor of actors) {
    if (actor.isReady) continue;
    actor.atbValue += actor.speed;
    if (actor.atbValue >= actor.atbMax) {
      // 故意不封顶：超出量就是同帧先手序，速度快的人先动。
      actor.isReady = true;
      ready.push(actor);
    }
  }
  ready.sort((a, b) => b.atbValue - a.atbValue);
  return ready;
}

/** 推进 n 个全局计数，按发生顺序返回期间就绪的人。 */
export function advanceTicks(
  actors: readonly AtbActor[],
  ticks: number
): AtbActor[] {
  const ready: AtbActor[] = [];
  for (let i = 0; i < ticks; i += 1) {
    for (const actor of advanceTick(actors)) ready.push(actor);
  }
  return ready;
}

/**
 * 还需要多少个全局计数才会就绪。
 * 0 = 已就绪；Infinity = speed 为 0，永远不会就绪。
 */
export function ticksUntilReady(actor: AtbActor): number {
  if (actor.isReady) return 0;
  if (actor.speed <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil((actor.atbMax - actor.atbValue) / actor.speed);
}

export function nextReadyTick(
  actors: readonly AtbActor[]
): { id: string; ticks: number } | null {
  let best: { id: string; ticks: number } | null = null;
  for (const actor of actors) {
    const ticks = ticksUntilReady(actor);
    if (!Number.isFinite(ticks)) continue;
    if (best === null || ticks < best.ticks) best = { id: actor.id, ticks };
  }
  return best;
}

/** 毫秒换算成**完整**计数步数；不足一步的余数丢弃，由客户端插值补足。 */
export function elapsedToTicks(elapsedMs: number, tickMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / tickMs));
}

export function msUntilReady(actor: AtbActor, tickMs: number): number {
  const ticks = ticksUntilReady(actor);
  return Number.isFinite(ticks) ? ticks * tickMs : Number.POSITIVE_INFINITY;
}

/**
 * 消费一次行动：扣掉进度并清掉就绪标记。cost 单位为 1/ATB_SCALE。
 */
export function consumeAction(actor: AtbActor, cost: number): void {
  actor.atbValue = Math.max(0, actor.atbValue - cost);
  actor.isReady = false;
}

export function readyOrder(actors: readonly AtbActor[]): AtbActor[] {
  return actors
    .filter((actor) => actor.isReady)
    .sort((a, b) => b.atbValue - a.atbValue);
}

export interface AtbSchedule {
  /** 距离下一个就绪事件还有多少个全局计数。 */
  readonly ticks: number;
  /** 对应的墙钟毫秒数，服务端据此安排唤醒。 */
  readonly ms: number;
  /** 该事件中会就绪的参与者 id，按就绪顺序。 */
  readonly ready: readonly string[];
}

/**
 * 事件调度：算出「下一个就绪事件」以及它的墙钟时间，
 * 服务端据此安排一次唤醒，不需要任何轮询。
 */
export function schedule(
  actors: readonly AtbActor[],
  tickMs: number
): AtbSchedule {
  let ticks = Number.POSITIVE_INFINITY;
  for (const actor of actors) {
    ticks = Math.min(ticks, ticksUntilReady(actor));
  }

  if (!Number.isFinite(ticks)) {
    return { ticks: Number.POSITIVE_INFINITY, ms: Number.POSITIVE_INFINITY, ready: [] };
  }
  if (ticks <= 0) {
    return { ticks: 0, ms: 0, ready: readyOrder(actors).map((actor) => actor.id) };
  }

  const clones: AtbActor[] = actors.map((actor) => ({ ...actor }));
  const ready: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    for (const actor of advanceTick(clones)) ready.push(actor.id);
  }
  return { ticks, ms: ticks * tickMs, ready };
}
