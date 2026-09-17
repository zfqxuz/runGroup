import { z } from "zod";

/**
 * 局内状态（GameCondition）是战斗内状态与战斗外状态的统一存储格式。
 *
 * 设计要点：
 * - 战斗里的 `CombatParticipantState` 是运行时快照，战斗结束后只把「应该保留的部分」写回局内状态。
 * - COC7 核心状态（重伤 / 倒地 / 昏迷 / 濒死 / 死亡）由 HP / CON 规则驱动，不允许作为普通法术状态添加。
 * - 法术 / 怪物能力 / KP 裁定产生的状态使用自定义 type，允许任意 key，但必须带来源、持续单位与可见性。
 */

/** 持续时间的单位。ROUND / CHARGE 只在战斗或充能消耗时扣减；其余按叙事时间推进。 */
export const GAME_CONDITION_UNITS = ["ROUND", "CHARGE", "MINUTE", "HOUR", "DAY", "NARRATIVE"] as const;
export type GameConditionUnit = (typeof GAME_CONDITION_UNITS)[number];

/** COC7 核心状态：只能由 HP / CON / SAN 规则触发，不能随意增删。 */
export const CORE_CONDITION_TYPES = [
  "MAJOR_WOUND",
  "PRONE",
  "UNCONSCIOUS",
  "DYING",
  "DEAD",
  "INSANITY"
] as const;
export type CoreConditionType = (typeof CORE_CONDITION_TYPES)[number];

export const GAME_CONDITION_VISIBILITIES = ["PUBLIC", "PARTY", "KP"] as const;
export type GameConditionVisibility = (typeof GAME_CONDITION_VISIBILITIES)[number];

/** 常用自定义状态示例；不是封闭枚举，任何字符串 key 都允许。 */
export const KNOWN_CUSTOM_CONDITION_TYPES = [
  "POSSESS",
  "STUN",
  "CONTROL",
  "ARMOR",
  "DOT",
  "POISON",
  "DISEASE",
  "CURSE",
  "BOUND",
  "SILENCE"
] as const;

export interface GameConditionDuration {
  readonly unit: GameConditionUnit;
  /** ROUND / CHARGE / MINUTE / HOUR / DAY 的剩余量；NARRATIVE 不使用。 */
  readonly remaining: number;
  /** NARRATIVE 持续时间的说明。 */
  readonly note?: string;
}

export interface GameCondition {
  readonly id: string;
  /** 核心状态或任意自定义 key，例如 POSSESS。 */
  readonly type: string;
  /** 状态来源（施法者 / 怪物 / 陷阱）。 */
  readonly sourceActorId?: string | null;
  /** 控制者（POSSESS 等控制类状态使用）。 */
  readonly controllerId?: string | null;
  /** 状态绑定的场景；跨场景时用于判断是否生效。 */
  readonly sceneId?: string | null;
  readonly duration: GameConditionDuration;
  readonly visibility: GameConditionVisibility;
  readonly data: Readonly<Record<string, unknown>>;
}

export const GameConditionDurationSchema = z.object({
  unit: z.enum(GAME_CONDITION_UNITS),
  remaining: z.number().finite().default(0),
  note: z.string().optional()
});

export const GameConditionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceActorId: z.string().nullable().optional(),
  controllerId: z.string().nullable().optional(),
  sceneId: z.string().nullable().optional(),
  duration: GameConditionDurationSchema,
  visibility: z.enum(GAME_CONDITION_VISIBILITIES).default("PUBLIC"),
  data: z.record(z.string(), z.unknown()).default({})
});

export type GameConditionInput = z.input<typeof GameConditionSchema>;

export function isCoreCondition(type: string): type is CoreConditionType {
  return (CORE_CONDITION_TYPES as readonly string[]).includes(type);
}

let conditionSeq = 0;

/** 生成稳定且可读的 condition id。 */
export function newConditionId(prefix = "cond"): string {
  conditionSeq += 1;
  return prefix + "-" + Date.now().toString(36) + "-" + conditionSeq.toString(36);
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

/** 宽容解析：可以是 JSON 字符串、对象数组或单对象；非法项直接忽略。 */
export function parseConditions(value: unknown): GameCondition[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    if (value.trim().length === 0) return [];
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const output: GameCondition[] = [];
  for (const item of list) {
    const parsed = GameConditionSchema.safeParse(item);
    if (parsed.success) {
      output.push({ ...parsed.data, data: { ...recordOf(parsed.data.data) } });
    }
  }
  return output;
}

export function emptyDuration(unit: GameConditionUnit, remaining = 0, note?: string): GameConditionDuration {
  return note === undefined ? { unit, remaining } : { unit, remaining, note };
}

export interface MakeConditionInput {
  readonly type: string;
  readonly id?: string;
  readonly sourceActorId?: string | null;
  readonly controllerId?: string | null;
  readonly sceneId?: string | null;
  readonly unit?: GameConditionUnit;
  readonly remaining?: number;
  readonly note?: string;
  readonly visibility?: GameConditionVisibility;
  readonly data?: Readonly<Record<string, unknown>>;
}

export function makeCondition(input: MakeConditionInput): GameCondition {
  const unit = input.unit ?? "ROUND";
  return {
    id: input.id ?? newConditionId(input.type.toLowerCase()),
    type: input.type,
    sourceActorId: input.sourceActorId ?? null,
    controllerId: input.controllerId ?? null,
    sceneId: input.sceneId ?? null,
    duration: emptyDuration(unit, input.remaining ?? 0, input.note),
    visibility: input.visibility ?? "PUBLIC",
    data: { ...(input.data ?? {}) }
  };
}

export function findConditions(conditions: readonly GameCondition[], type: string): GameCondition[] {
  return conditions.filter((condition) => condition.type === type);
}

export function findCondition(conditions: readonly GameCondition[], type: string): GameCondition | null {
  return conditions.find((condition) => condition.type === type) ?? null;
}

export function hasCondition(conditions: readonly GameCondition[], type: string): boolean {
  return findCondition(conditions, type) !== null;
}

/** 同类状态按 id 覆盖；未指定 id 时追加。返回新数组，不修改入参。 */
export function upsertCondition(conditions: readonly GameCondition[], condition: GameCondition): GameCondition[] {
  const index = conditions.findIndex((item) => item.id === condition.id);
  if (index < 0) return [...conditions, condition];
  const next = [...conditions];
  next[index] = condition;
  return next;
}

export function removeConditions(conditions: readonly GameCondition[], types: readonly string[]): GameCondition[] {
  if (types.length === 0) return [...conditions];
  const wanted = new Set(types);
  return conditions.filter((condition) => wanted.has(condition.type) === false);
}

export function removeConditionById(conditions: readonly GameCondition[], id: string): GameCondition[] {
  return conditions.filter((condition) => condition.id !== id);
}

export interface TickConditionsResult {
  readonly conditions: GameCondition[];
  readonly expired: GameCondition[];
}

/**
 * 按指定单位推进持续时间。
 * - steps 为消耗格数（战斗轮次 / Token 移动次数）。
 * - remaining <= 0 的状态会进入 expired 并从结果里移除。
 * - NARRATIVE 与单位不匹配的状态原样保留。
 */
export function tickConditions(
  conditions: readonly GameCondition[],
  unit: GameConditionUnit,
  steps = 1
): TickConditionsResult {
  if (steps <= 0) return { conditions: [...conditions], expired: [] };
  const kept: GameCondition[] = [];
  const expired: GameCondition[] = [];
  for (const condition of conditions) {
    if (condition.duration.unit !== unit) {
      kept.push(condition);
      continue;
    }
    const remaining = condition.duration.remaining - steps;
    if (remaining <= 0) {
      expired.push({ ...condition, duration: { ...condition.duration, remaining: 0 } });
      continue;
    }
    kept.push({ ...condition, duration: { ...condition.duration, remaining } });
  }
  return { conditions: kept, expired };
}

/** 战斗内 / 战斗外统一的 POSSESS 充能池读取。 */
export function possessChargeRemaining(conditions: readonly GameCondition[]): number | null {
  const possess = findCondition(conditions, "POSSESS");
  if (possess === null) return null;
  if (possess.duration.unit !== "CHARGE") return null;
  return Math.max(0, possess.duration.remaining);
}
