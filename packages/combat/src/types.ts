import type {
  ActiveStatusEffect,
  AttributeSet,
  CheckResult,
  DerivedStats
} from "@touhou/rules";

export type CombatMode = 'INITIATIVE' | 'ATB';
export type CombatPhase = "ATB_CHARGING" | "AWAITING_ACTION" | "ENDED";
export type ParticipantKind = "PLAYER" | "NPC";
export type ActionKind =
  | "DANMAKU"
  | "SPELLCARD"
  | "MAGIC"
  | "OUT_OF_RULE"
  | "DEFEND"
  | "DODGE"
  | "COUNTER"
  | "ITEM"
  | "FLEE"
  | "PASS";

/** 展开型符卡。它有独立 HP，被击破时按规则清场。 */
export interface SpellDeclaration {
  readonly name: string;
  /** 独立 HP；伤害先扣这里，扣完才轮到本体。 */
  hp: number;
  readonly maxHp: number;
  readonly expiresAtTick: number;
  readonly clearTargets: "ALL" | "OTHERS_ONLY";
  /** 展开期间本体获得的比例减伤，1 表示不减。 */
  readonly damageMultiplier: number;
}

export interface CombatParticipantState {
  readonly id: string;
  readonly name: string;
  readonly kind: ParticipantKind;
  readonly characterId: string | null;
  /** 阵营。KP 可见；PL 在未识别时看不到。 */
  readonly faction: string;

  atbValue: number;
  atbMax: number;
  /** 未经状态效果修正的基础速度。 */
  baseSpeed: number;
  /** 实际速度 = baseSpeed * 状态乘数。 */
  speed: number;
  isReady: boolean;
  defeated: boolean;

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  dp: number;
  maxDp: number;

  attributes: AttributeSet;
  derived: DerivedStats;
  skills: Record<string, number>;
  /** 伤害表达式里 `db` 的替换值，例如 "1d4" / "-2" / "0"。 */
  damageBonus: string;
  /** 公式求值作用域：attributes + derived + atbMax。 */
  vars: Record<string, number>;

  statusEffects: ActiveStatusEffect[];
  declaration: SpellDeclaration | null;
  usedSpellCards: string[];
  isIdentified: boolean;
  /** 对玩家公开属性；默认隐藏，公开后战斗视图展示 HP 等数值。 */
  isPublic: boolean;
  /** 需要强制跳过行动的剩余次数（眩晕 / 控制）。 */
  stunActions?: number;
  controlActions?: number;
}
export interface ActionSubmission {
  readonly actorId: string;
  readonly kind: ActionKind;
  readonly targetId?: string | null;
  /** 攻击技能名，用于查表得到目标值。 */
  readonly skill?: string;
  /** 伤害骰，如 "2d6+3"。 */
  readonly damage?: string;
  readonly accuracyMod?: number;
  /** 本次行动消耗的 ATB 进度（微计数）。 */
  readonly atbCost?: number;
  /** 符卡 / 法术。 */
  readonly name?: string;
  readonly spellId?: string;
  readonly mpCost?: number;
  readonly sanCost?: string;
  readonly spellcardMode?: "DECLARATION" | "CONSUMPTION";
  /** 展开型符卡的独立 HP（由调用方按 RulePack 的 hpRatio 算好）。 */
  readonly declarationHp?: number;
  readonly declarationDurationTicks?: number;
  readonly status?: { readonly key: string; readonly stacks: number };
}

export type LogField = number | string | boolean | null;

export interface LogEntry {
  readonly seq: number;
  readonly tick: number;
  readonly kind:
    | "ACTION"
    | "CHECK"
    | "DAMAGE"
    | "STATUS"
    | "SPELLCARD"
    | "DEFEAT"
    | "SYSTEM";
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly text: string;
  readonly data?: Record<string, number | string | boolean | null>;
}

export type ChaseSide = "PREY" | "CHASER";

export interface ChaseParticipantState {
  readonly id: string;
  readonly name: string;
  readonly side: ChaseSide;
  /** 速度检定前的基础 MOV。 */
  readonly baseMov: number;
  /** 速度检定调整后的 MOV。 */
  mov: number;
  /** 当前地点（0 ~ trackLength-1）。 */
  position: number;
  /** 本轮剩余行动点。 */
  actionPoints: number;
  /** 本轮最大行动点 = 1 + (MOV - 全场最低 MOV)。 */
  readonly maxActionPoints: number;
  readonly speedRoll: number;
  readonly speedResult: CheckResult;
  /** 主动退出追逐：仍在名单中供视图展示，但不再行动。 */
  withdrawn: boolean;
}

export interface ChaseState {
  status: "ACTIVE" | "ESCAPED" | "CAUGHT" | "ENDED";
  round: number;
  activeIndex: number;
  /** 追逐行动顺序（按 DEX 从高到低）。 */
  order: string[];
  /** 地点总数；prey 抵达最后一个地点即逃脱。 */
  trackLength: number;
  participants: ChaseParticipantState[];
  /** 结束原因 / 最近一次裁决说明。 */
  ending: string | null;
}

export interface CombatState {
  readonly id: string;
  readonly seed: string;
  readonly tickMs: number;
  /** INITIATIVE = COC7；ATB = 东方。 */
  readonly mode: CombatMode;
  initiativeOrder: string[];
  activeIndex: number;
  tick: number;
  round: number;
  phase: CombatPhase;
  /** 单调递增的事件序号，也是 RNG 的派生输入。 */
  seq: number;
  /** 独立掷骰序号：RNG 只由 seed + rollSeq 派生。 */
  rollSeq: number;
  participants: CombatParticipantState[];
  pending: Record<string, ActionSubmission>;
  log: LogEntry[];
  /** 追逐状态；null 表示当前不在追逐中。 */
  chase: ChaseState | null;
}
