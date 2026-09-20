import type {
  ActiveStatusEffect,
  AttributeSet,
  CheckResult,
  DerivedStats,
  GameCondition,
  MagicEffect,
  MagicTargeting
} from "@touhou/rules";

export type CombatMode = 'INITIATIVE' | 'ATB' | 'DP';
export type CombatPhase = "ATB_CHARGING" | "AWAITING_ACTION" | "ENDED" | "DP_DECLARATION";
export type ParticipantKind = "PLAYER" | "NPC";
export type ActionKind =
  | "DANMAKU"
  | "SPELLCARD"
  | "MAGIC"
  | "OUT_OF_RULE"
  | "DEFEND"
  | "DODGE"
  | "COUNTER"
  | "MANEUVER"
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
  /** 释放这张符卡时对应的卡牌 id；用于前端匹配弹幕演出。 */
  readonly cardId: string | null;
  /** 展开期间本体获得的比例减伤，1 表示不减。 */
  readonly damageMultiplier: number;
  /** 展开型 SC 的强化方向；null 表示没有强化数据。 */
  readonly enhanceType: "DANMAKU" | "MELEE" | "SPELL" | "AREA" | null;
  /** 强化倍率或加值；由卡牌数据提供，缺省 1。 */
  readonly enhanceValue: number;
  /** 是否为 LSC（Last Spell Card）；被击破时立刻气绝。 */
  readonly isLsc?: boolean;
}

/** 千幻抄结界（7.5）：独立 HP，吸收伤害直到击破或到期。 */
export interface BarrierState {
  hp: number;
  maxHp: number;
  name: string;
  /** 到期轮次；null 表示直到击破或战斗结束。 */
  expiresAtRound: number | null;
  /** 7.5 结界大小（米，表 7.1）。 */
  sizeMeters?: number;
  /** 7.5 结界档位 id（如 SIZE_10）；未查表时为 null。 */
  sizeId?: string | null;
  /** 使用该大小所需的神术·阴阳术等级（必要 Lv）。 */
  requiredLevel?: number | null;
  /** 解除 / 抵抗对抗的目标值；0 表示无需对抗。 */
  targetValue?: number;
  /** 结界内战斗惩罚（回避减值）。 */
  penalty?: number;
  /** SELF 贴在目标身上；AREA 占据区域（范围模型接入后使用）。 */
  anchor?: "SELF" | "AREA";
  /** 持续时间（小时），由术者等级 × 2 得来。 */
  durationHours?: number;
}

/** 14.12 物理掩体 / 遮挡物：提供应对加值并吸收伤害直到耐久耗尽。 */
export interface CoverState {
  name: string;
  /** 掩体等级：应对达成值 +level×2，并作为强度档。 */
  level: number;
  /** 掩体耐久；0 表示无耐久（只提供应对加值，不吸收伤害）。 */
  hp: number;
  maxHp: number;
  /** 到期轮次；null 表示直到击破或战斗结束。 */
  expiresAtRound: number | null;
  /** 是否阻挡视线（远程攻击需先处理掩体）。 */
  blocksLineOfSight?: boolean;
}

/** 常时被动加值：由 AbilityDefinition.passives 在战斗准备时汇总。 */
export interface CombatPassiveMods {
  readonly damageBonus: number;
  readonly reactionBonus: number;
  readonly accuracyBonus: number;
  readonly movementBonus: number;
  /** 每 N 点擦弹额外 +1（擦弹判定大）；0 表示不生效。 */
  readonly grazeBonusPer: number;
  /** 受到弹幕攻击时回避 DP 减少值（被弹判定小）。 */
  readonly danmakuDpReduction: number;
  /** 受到弹幕攻击时固定伤害减免。 */
  readonly danmakuDamageReduction: number;
  /** 近战 / 射击 / 追击追加的 d6 骰数。 */
  readonly damageDice: number;
  /** 弹幕固定伤害加值。 */
  readonly danmakuDamageBonus: number;
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
  /** COC7 重伤标记：单次伤害达到最大 HP 一半。 */
  majorWound?: boolean;
  /** 重伤后倒地（仍可能保持意识）。 */
  prone?: boolean;
  /** 昏迷：重伤 CON 检定失败、HP 归零或濒死时。 */
  unconscious?: boolean;
  /** 濒死：已受重伤且 HP 归零，每轮结束需 CON 检定。 */
  dying?: boolean;
  /** 已死亡（重伤濒死检定失败或单次伤害达到最大 HP）。 */
  dead?: boolean;
  /** 进入濒死时所在轮次，用于计算「下一轮结束」的第一次 CON 检定。 */
  dyingSinceRound?: number;

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  dp: number;
  maxDp: number;
  /** 千幻抄擦弹点数；战斗结束后消失。 */
  grazePoints: number;
  /** 已消费擦弹点预存的伤害加值；下一次对应攻击结算后清零。 */
  grazeDamageBonus?: number;
  grazeDamageBonusKind?: "MELEE" | "RANGED" | undefined;
  /** 可消耗护甲：按 1:1 吸收伤害，吸收后扣减。 */
  armor: number;
  maxArmor: number;
  /** 被哪个单位召唤入场；普通单位 / 玩家为 null。 */
  summonedBy?: string | null;
  summonedName?: string | null;
  /** 护甲到期轮次；null / undefined 表示直到耗尽或战斗结束。 */
  armorExpiresAtRound?: number | null;
  /** 召唤物到期轮次；null / undefined 表示直到战斗结束。 */
  summonExpiresAtRound?: number | null;
  /** 夺舍者 id；null / undefined 表示未被夺舍。 */
  possessedBy?: string | null;
  /** 夺舍充能池剩余量：每经过 1 个战斗轮次或 1 次被夺舍 Token 移动消耗 1 格。 */
  possessCharges?: number;
  /**
   * 局内持久状态快照（从 GameCharacter.conditions / Card.stats.conditions 读入）。
   * 战斗结束时会连同核心状态与夺舍充能一起写回。
   */
  conditions?: GameCondition[];

  attributes: AttributeSet;
  derived: DerivedStats;
  /** 规则包中的种族 key；COC7 单位 / 无种族单位为 null。 */
  race?: string | null;
  /** 种族扁平 flags（旧口径，UI 与规则都会读）。 */
  raceFlags?: string[];
  /** 先天 / 装备元素亲和与抗性；用于属性相克。 */
  elements?: string[];
  /** 千幻抄能力等级：categoryId -> Lv；COC7 单位为空对象。 */
  abilityLevels?: Record<string, number>;
  /** 千幻抄能力实例指定的发动特性值（如属性使选 {知性}/{感觉}）。 */
  abilityAttributes?: Record<string, string>;
  /** 常时被动加值（妖力 / 常时特技）；战斗准备时由规则层算出。 */
  passiveMods?: CombatPassiveMods;
  /** 千幻抄 14.3：灵力归零导致昏迷；灵力恢复后清除。 */
  mpExhausted?: boolean;
  skills: Record<string, number>;
  /** 该单位允许施放的法术 id；玩家来自角色卡，NPC 来自 NPC 卡。 */
  spells: string[];
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
  /** 道具剩余使用次数：cardId -> 剩余次数。仅记录有限次道具。 */
  itemUsesLeft?: Record<string, number>;
  /** 道具冷却到期轮次：cardId -> 可再次使用的轮次。 */
  itemCooldownUntil?: Record<string, number>;
  /** 放弃接下来 N 次行动（寻找掩体等）。 */
  skipNextAction?: number;
  /** 被擒抱者 id；非空时承受擒抱惩罚。 */
  grappledBy?: string | null;
  /** 已被缴械：服务端攻击选项会被过滤。 */
  disarmed?: boolean;
  /** 本轮已经进行过的应对次数（寡不敌众）。 */
  reactionsThisRound?: number;
  /** DP 掩护：本轮是否已经掩护过他人（前卫一回合一次）。 */
  coverUsedThisRound?: boolean;
  /** DP 能力：本轮是否已经发动过能力（千幻抄原则上每回合一次）。 */
  abilityUsedThisRound?: boolean;
  /** 展开中的结界；null 表示没有。 */
  barrier?: BarrierState | null;
  /** 14.12 当前所处掩体；null / undefined 表示无掩体。 */
  cover?: CoverState | null;
  /** 已使用过 LSC：之后不能再使用任何符卡。 */
  lscUsed?: boolean;
  /** LSC 被击破：立刻气绝，30 分钟内 DP 上限视为 0。 */
  lscBroken?: boolean;
  /** LSC 被击破的时间（ISO 字符串）；用于 30 分钟后恢复 DP 上限。 */
  lscBrokenAt?: string | null;
  /** INITIATIVE 先攻修正（准备火器 +50 等）。 */
  initiativeMod?: number;
}
/**
 * 召唤模板。服务端从房间内独立 NPC 卡解析后塞进 ActionSubmission，
 * 纯战斗引擎只负责把模板变成参战单位。
 */
export interface SummonTemplate {
  readonly name: string;
  readonly attributes: AttributeSet;
  readonly derived: DerivedStats;
  readonly skills?: Readonly<Record<string, number>>;
  readonly spells?: readonly string[];
  readonly damageBonus?: string;
  readonly weapons?: readonly unknown[];
  /** 召唤物自带护甲表达式，如 "2d6"；入场时由引擎掷出。 */
  readonly armorExpression?: string;
}

/** U-3：一次行动内的单步攻击（可换技能 / 换目标 / 连射）。 */
export interface RoutineAttackStep {
  readonly targetId: string;
  readonly skill?: string;
  readonly damage?: string;
  readonly damageType?: "BLUNT" | "IMPALING" | "NONE";
  /** 本次攻击的元素属性 id；服务端从武器卡解析。 */
  readonly element?: string;
  readonly shots?: number;
  readonly accuracyMod?: number;
  readonly bonusDice?: number;
  readonly bonusDiceSource?: string;
  readonly penaltyDice?: number;
}

export interface ActionSubmission {
  readonly actorId: string;
  readonly kind: ActionKind;
  readonly targetId?: string | null;
  /** U-3：多目标 / 多技能攻击 routine；存在时按顺序逐条结算。 */
  readonly routine?: readonly RoutineAttackStep[];
  /** 攻击技能名，用于查表得到目标值。 */
  readonly skill?: string;
  /** 伤害骰，如 "2d6+3"。 */
  readonly damage?: string;
  /** COC7 武器伤害类型：极限成功时决定是否额外掷武器骰。 */
  readonly damageType?: "BLUNT" | "IMPALING" | "NONE";
  /** 攻击 / 法术的元素属性 id；服务端从装备或规则包解析，客户端不可伪造。 */
  readonly element?: string;
  /** DP 模式行动种类：弹幕 / 射击 / 追击 / 近战 / 其他技能判定。 */
  readonly dpAction?: "DANMAKU" | "RANGED" | "CHASE" | "MELEE" | "SKILL";
  /** DP 模式本次判定消费的骰数（1 骰 = 1 DP × 规则包单价）。 */
  readonly dpDice?: number;
  /** DP 模式判定使用的特性值 key；缺省由行动种类决定。 */
  readonly dpAttribute?: string;
  /** DP 其他行动：目标达成值（技能判定用）。 */
  readonly dpTargetValue?: number;
  /** DP 近战：命中判定的骰数（接近判定用 dpDice）。 */
  readonly dpSecondaryDice?: number;
  /** DP 追击：多目标 id 列表。 */
  readonly dpTargetIds?: readonly string[];
  /** DP 追击：追加消费次数（每 +2 DP，达成值 +10）。 */
  readonly dpEscalation?: number;
  /** 弹幕回避时需要减少的 DP 数（由弹幕等级 / 卡牌决定）。 */
  readonly danmakuDpReduction?: number;
  /** 弹幕回避者 DP 不足时的固定伤害。 */
  readonly danmakuBaseDamage?: number;
  /**
   * DP 千幻抄伤害公式：用作 LvD 的能力类别 id（射击 / 追击 / 能力伤害）。
   * 提供时引擎按「能力 LvD + 特性值」计算伤害，忽略卡面 damage。
   */
  readonly damageAbilityId?: string;
  /** DP 千幻抄近战伤害公式：用作 LvD 的锻炼类别 id（通常 "FEAT"）。 */
  readonly damageTrainingId?: string;
  /** DP 千幻抄伤害公式：提供固定加值的武器技能 id（射击 / 近战共用）。 */
  readonly damageWeaponSkill?: string;
  /** COC7 手枪连射：同一动作内的射击次数（1–3）。 */
  readonly shots?: number;
  /** COC7 战技：缴械 / 踢倒 / 擒拿。 */
  readonly maneuver?: "DISARM" | "TRIP" | "GRAPPLE";
  /** 连射时的当前发数与总发数；用于日志与逐发结算。 */
  readonly shotIndex?: number;
  readonly shotCount?: number;
  /** 本次检定奖励骰 / 惩罚骰（由服务端或引擎规则推导，客户端不可直接篡改）。 */
  readonly bonusDice?: number;
  readonly penaltyDice?: number;
  /** 奖励骰来源标签（如“近距离点射”）；仅用于日志展示。 */
  readonly bonusDiceSource?: string;
  readonly accuracyMod?: number;
  /** 本次行动消耗的 ATB 进度（微计数）。 */
  readonly atbCost?: number;
  /** 符卡 / 法术。 */
  readonly name?: string;
  readonly spellId?: string;
  /** 本次能力发动的能力等级；由 resolveAbility 写入，LvD / +Lv 缩放使用。 */
  readonly abilityLevel?: number;
  /** 玩家卡库中的符卡 id；服务端会用它反查卡牌数值。 */
  readonly spellCardId?: string;
  readonly mpCost?: number;
  readonly sanCost?: string;
  readonly spellcardMode?: "DECLARATION" | "CONSUMPTION";
  /** 展开型符卡的独立 HP（由调用方按 RulePack 的 hpRatio 算好）。 */
  readonly declarationHp?: number;
  readonly declarationDurationTicks?: number;
  /** 本次展开是否宣告为 LSC。 */
  readonly declarationLsc?: boolean;
  /** PASS 行动是否用于主动放弃展开中的符卡。 */
  readonly abandonDeclaration?: boolean;
  /** 服务端从卡牌数据解析出的击破清弹范围。 */
  readonly declarationClearTargets?: "ALL" | "OTHERS_ONLY";
  /** 客户端不能直接决定强化数值；服务端从卡牌数据写入。 */
  readonly spellcardEnhanceType?: "DANMAKU" | "MELEE" | "SPELL" | "AREA";
  readonly spellcardEnhanceValue?: number;
  readonly status?: { readonly key: string; readonly stacks: number };
  /** 擦弹点消费：PASS 行动可携带；由服务端校验点数。 */
  readonly grazeSpend?: "MP" | "MELEE_DAMAGE" | "RANGED_DAMAGE";
  /** SUMMON 法术的服务端解析结果；没有时由引擎使用通用兜底召唤物。 */
  readonly summonTemplate?: SummonTemplate;
  /** 道具卡：服务端按卡牌数据解析出的通用效果。 */
  readonly itemCardId?: string;
  readonly effects?: readonly MagicEffect[];
  readonly targeting?: MagicTargeting;
  readonly targetScope?: "SELF" | "ONE" | "ALL";
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

/** DP（Dice Pool）模式的一轮状态。 */
export interface DpRoundState {
  /** participantId -> 本轮声明的 DP（越小越后行动）。 */
  declared: Record<string, number>;
  /** participantId -> 下轮 DP 回复加成（待机 +2）。 */
  regenBonus: Record<string, number>;
  /** 本轮已行动过的 participantId。 */
  acted: string[];
}

/** 千幻抄符卡战斗：一方本场可用的 SC 总数。 */
export interface SpellcardBattleState {
  /** faction -> 本场可用 SC 总数（按「能使用 SC 的人数」自动计算）。 */
  sideUsable: Record<string, number>;
  /** faction -> 战斗开始前双方选定的 SC 卡 id；缺省表示未做战前宣言（不额外限制卡池）。 */
  declaredCardIds?: Record<string, readonly string[]>;
}

export interface CombatState {
  readonly id: string;
  readonly seed: string;
  readonly tickMs: number;
  /** INITIATIVE = COC7；ATB = 东方旧模式；DP = 千幻抄。 */
  readonly mode: CombatMode;
  /** DP 模式专用的一轮状态；其他模式为 null。 */
  dp?: DpRoundState | null;
  /** 千幻抄符卡战斗的每方 SC 池；仅 TOUHOU + 有符卡规则时非空。 */
  spellcardBattle?: SpellcardBattleState | null;
  initiativeOrder: string[];
  activeIndex: number;
  tick: number;
  round: number;
  phase: CombatPhase;
  /** 单调递增的事件序号，也是 RNG 的派生输入。 */
  seq: number;
  /** 独立掷骰序号：RNG 只由 seed + rollSeq 派生。 */
  rollSeq: number;
  /** 召唤序号，用于生成可回放的召唤单位 id。 */
  summonSeq: number;
  participants: CombatParticipantState[];
  pending: Record<string, ActionSubmission>;
  log: LogEntry[];
  /** 追逐状态；null 表示当前不在追逐中。 */
  chase: ChaseState | null;
}
