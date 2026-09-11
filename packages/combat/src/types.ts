import type {
  ActiveStatusEffect,
  AttributeSet,
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
  /** 公式求值作用域：attributes + derived + atbMax。 */
  vars: Record<string, number>;

  statusEffects: ActiveStatusEffect[];
  declaration: SpellDeclaration | null;
  usedSpellCards: string[];
  isIdentified: boolean;
  /** 对玩家公开属性；默认隐藏，公开后战斗视图展示 HP 等数值。 */
  isPublic: boolean;
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
}
