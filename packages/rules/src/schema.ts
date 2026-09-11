import { z } from "zod";

const SEMVER = /^\d+\.\d+\.\d+$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const PACK_REF = /^[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+$/;

/** 纯函数表达式。禁止出现骰子 —— 骰子必须走 DiceExpr。 */
export const ExprSchema = z.string().min(1);

/** 骰子表达式，如 "2d6+3"。 */
export const DiceExprSchema = z.string().min(1);

export const PIPELINE_STEPS = [
  "BASE_DICE",
  "SPELLCARD_MULT",
  "ENHANCE_MOD",
  "DEFEND_REDUCE",
  "COUNTER_RESOLVE",
  "GRAZE_RESOLVE",
  "SHIELD_REDUCE",
  "CLAMP_MIN_ZERO"
] as const;

export const ACTION_COST_KEYS = [
  "DANMAKU",
  "SPELLCARD",
  "DEFEND",
  "DODGE",
  "COUNTER",
  "ITEM",
  "FLEE",
  "PASS"
] as const;

export const RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const;

export const RACE_CATEGORIES = ["COC7", "TOUHOU"] as const;

/** 预设 NPC 强度等级。用于 KP 快速筛选。 */
export const PRESET_TIERS = ["MINION", "STANDARD", "ELITE", "BOSS"] as const;

/** 预设 NPC 的最终属性值（已计入种族修正，不再走车卡流程）。 */
export const PresetAttributesSchema = z.object({
  str: z.number().int().min(0).max(999),
  con: z.number().int().min(0).max(999),
  siz: z.number().int().min(0).max(999),
  dex: z.number().int().min(0).max(999),
  app: z.number().int().min(0).max(999),
  int: z.number().int().min(0).max(999),
  pow: z.number().int().min(0).max(999),
  edu: z.number().int().min(0).max(999),
  luck: z.number().int().min(0).max(999)
});

/**
 * 预设角色。随规则包版本发布，KP 可直接选用生成 ROOM 作用域的 NPC 卡。
 * attributes / skills / max* 均为最终值，物化时不要再次套用种族修正。
 * race 仅用于展示、特性 flag 与技能表联动。
 */
export const PresetCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  tier: z.enum(PRESET_TIERS).default("STANDARD"),
  rarity: z.enum(RARITIES).default("COMMON"),
  race: z.string().nullable().default(null),
  attributes: PresetAttributesSchema,
  skills: z.record(z.string(), z.number().int().min(0).max(999)).default({}),
  maxHp: z.number().int().min(0).optional(),
  maxMp: z.number().int().min(0).optional(),
  maxSan: z.number().int().min(0).optional(),
  maxDp: z.number().int().min(0).optional(),
  tags: z.array(z.string()).default([])
});

export const RaceSchema = z.object({
  /** 显示名，例如「妖精」。id 是 key，玩家看到的是这个。 */
  name: z.string(),
  description: z.string().optional(),
  attrMods: z.record(z.string(), ExprSchema).default({}),
  derivedOverrides: z.record(z.string(), ExprSchema).default({}),
  skillBonuses: z.record(z.string(), ExprSchema).default({}),
  /** 种族专属兴趣点公式；缺省时使用规则包全局 skillPoints.interest。 */
  interestPoints: ExprSchema.optional(),
  flags: z.array(z.string()).default([])
});

export const StatusEffectSchema = z.object({
  stack: z.enum(["STACK", "REFRESH", "REPLACE"]),
  maxStacks: z.number().int().min(1).default(1),
  durationTicks: ExprSchema,
  speedMultiplier: ExprSchema.optional(),
  damageMultiplier: ExprSchema.optional()
});

export const DamageRulesSchema = z.object({
  pipeline: z.array(z.enum(PIPELINE_STEPS)).nonempty(),
  defend: z.object({
    cost: ExprSchema,
    reduceMultiplier: ExprSchema
  }),
  dodge: z.object({
    cost: ExprSchema,
    grazeMpGainRatio: ExprSchema
  }),
  counter: z.object({
    cost: ExprSchema,
    failDamageRatio: ExprSchema
  })
});

/** 模组携带的魔法规则。由 DeepSeek 在团本准备阶段整理，KP 在房间里启用。 */
export const MagicSpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 施法检定使用的技能 id；COC7 缺省用 OCCULT，东方缺省用 MAGIC。 */
  skill: z.string().default("MAGIC"),
  description: z.string().optional(),
  mpCost: ExprSchema.default("0"),
  sanCost: DiceExprSchema.default("0"),
  /** 命中后的伤害骰；没有则视为纯叙事 / 支援法术。 */
  damage: DiceExprSchema.optional(),
  target: z.enum(["SELF", "ONE", "ALL"]).default("ONE")
});

export const MagicRulesSchema = z.object({
  enabled: z.boolean().default(false),
  system: z.enum(["COC7", "TOUHOU"]).optional(),
  spells: z.array(MagicSpellSchema).default([])
});

export const SpellCardRulesSchema = z.object({
  declaration: z.object({
    hpRatio: ExprSchema,
    durationTicks: ExprSchema,
    onBreakClearDanmaku: z.boolean().default(true),
    clearTargets: z.enum(["ALL", "OTHERS_ONLY"]).default("ALL")
  }),
  consumption: z.object({
    mpCost: ExprSchema,
    oncePerCombat: z.boolean().default(true)
  }),
  enhance: z.record(z.string(), z.record(z.string(), ExprSchema)).default({}),
  outOfRule: z.object({
    mpCost: ExprSchema,
    sanCost: DiceExprSchema
  })
});

/**
 * 技能定义。base 是基础值公式（只能用属性），例如「闪避」= dex/2。
 * 东方包会整体替换 COC7 的技能表 —— 数组在深合并时是替换语义。
 */
export const SKILL_CATEGORIES = [
  "COMBAT",
  "MAGIC",
  "SOCIAL",
  "KNOWLEDGE",
  "PHYSICAL",
  "TECH",
  "OTHER"
] as const;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(SKILL_CATEGORIES),
  base: ExprSchema,
  description: z.string().optional()
});

/**
 * 车卡方式。规则包可以同时提供多种，玩家任选。
 *
 * ROLL_SETS —— 掷 N 组（每组每项 NdM×倍率），选一组。这就是「天命 5」。
 * POINT_BUY —— 总点数分配，单项有上下限。
 * MANUAL    —— 手动填写，交给 KP 裁量。
 */
export const AttributeMethodSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ROLL_SETS"),
    id: z.string(),
    label: z.string(),
    sets: z.number().int().min(1).max(20),
    dice: z.string(),
    multiplier: z.number().int().min(1)
  }),
  z.object({
    kind: z.literal("POINT_BUY"),
    id: z.string(),
    label: z.string(),
    total: z.number().int().positive(),
    perAttributeMin: z.number().int().positive(),
    perAttributeMax: z.number().int().positive()
  }),
  z.object({
    kind: z.literal("MANUAL"),
    id: z.string(),
    label: z.string()
  })
]);

/**
 * 战斗模式。
 *
 * INITIATIVE — COC7：KP 每轮排定出手顺序，随后全员依次行动。
 * ATB        — 东方：全局计数器推进，谁进度先满谁行动。
 */
export const COMBAT_MODES = ["INITIATIVE", "ATB"] as const;

/**
 * 战斗事件规则表。
 *
 * 每个事件都必须有真实实现 —— 只加配置不加分支的开关是假开关。
 * params 是公式，可用属性与常量，含义由实现层按事件 id 解释。
 */
export const CombatEventSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  defaultEnabled: z.boolean().default(true),
  params: z.record(z.string(), ExprSchema).default({})
});

export const CombatRulesSchema = z.object({
  mode: z.enum(COMBAT_MODES),
  /** INITIATIVE 模式专用。 */
  initiative: z
    .object({
      /** 排序依据，默认 DEX。 */
      key: ExprSchema,
      tieBreak: z.enum(["KEY_DESC", "RANDOM", "KP"]).default("KEY_DESC"),
      /** COC7 允许 KP 手动调整出手顺序。 */
      kpAdjustsOrder: z.boolean().default(true)
    })
    .optional(),
  events: z.record(z.string(), CombatEventSchema).default({})
});

export const RulePackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(SLUG),
  system: z.enum(["COC7", "TOUHOU"]),
  version: z.string().regex(SEMVER),
  extends: z.array(z.string().regex(PACK_REF)).default([]),
  const: z.record(z.string(), z.number()).default({}),

  attributes: z.object({
    min: z.number().int().min(0),
    max: z.number().int().max(999),
    /** 可选的车卡方式，第一个为默认。 */
    methods: z.array(AttributeMethodSchema).min(1)
  }),

  derived: z.record(z.string(), ExprSchema),

  check: z.object({
    criticalAt: ExprSchema,
    extremeDivisor: ExprSchema,
    hardDivisor: ExprSchema,
    fumbleFlat: ExprSchema,
    fumbleSkillBelow: ExprSchema,
    fumbleRangeFrom: ExprSchema,
    allowPush: z.boolean().default(true),
    pushCost: ExprSchema.optional()
  }),

  atb: z.object({
    tickMs: z.number().int().min(50).max(2000),
    max: ExprSchema,
    speed: ExprSchema,
    actionCost: z.record(z.enum(ACTION_COST_KEYS), ExprSchema).default({}),
    tieBreak: z.enum(["DEX_DESC", "RANDOM"]).default("DEX_DESC")
  }),

  combat: CombatRulesSchema,
  damage: DamageRulesSchema,
  races: z.record(z.string(), RaceSchema).default({}),

  presets: z.array(PresetCharacterSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  skillPoints: z
    .object({
      /** 职业技能点，公式只能用属性，例如 "edu * 4"。 */
      occupation: ExprSchema,
      /** 兴趣技能点，例如 "int * 2"。 */
      interest: ExprSchema,
      /** 旧字段：统一单项上限；新逻辑优先使用 occupationMax / interestMax。 */
      maxAtCreation: ExprSchema.default("70"),
      /** 本职技能使用职业点后的最终上限。 */
      occupationMax: ExprSchema.default("80"),
      /** 兴趣技能使用兴趣点后的最终上限。 */
      interestMax: ExprSchema.default("70")
    })
    .default({ occupation: "edu * 4", interest: "int * 2", maxAtCreation: "70", occupationMax: "80", interestMax: "70" }),
  statusEffects: z.record(z.string(), StatusEffectSchema).default({}),
  spellcard: SpellCardRulesSchema.optional(),
  magic: MagicRulesSchema.optional(),

  cardBudget: z
    .object({
      maxRarityByRole: z.record(z.string(), z.enum(RARITIES)).default({}),
      pointBudget: z.record(z.string(), z.number()).default({})
    })
    .optional()
});

export type RulePack = z.output<typeof RulePackSchema>;
export type RulePackInput = z.input<typeof RulePackSchema>;
export type Race = z.output<typeof RaceSchema>;
export type StatusEffectRule = z.output<typeof StatusEffectSchema>;
export type DamageRules = z.output<typeof DamageRulesSchema>;
export type SpellCardRules = z.output<typeof SpellCardRulesSchema>;
export type MagicSpell = z.output<typeof MagicSpellSchema>;
export type MagicRules = z.output<typeof MagicRulesSchema>;
export type ActionCostKey = (typeof ACTION_COST_KEYS)[number];
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** 解析并返回强类型 RulePack；失败时抛出 ZodError。 */
export function parseRulePack(input: unknown): RulePack {
  return RulePackSchema.parse(input);
}

/** 所有系统都必须定义的行动消耗。弹幕 / 符卡由东方包补充。 */
export const CORE_ACTION_COSTS = [
  "DEFEND",
  "DODGE",
  "COUNTER",
  "ITEM",
  "PASS",
  "FLEE"
] as const;

/**
 * 叠加包：只写需要覆盖的字段，其余从 extends 继承。
 * 模组作者分发的平衡包就长这个样子。
 */
export const RulePackOverlaySchema = RulePackSchema.partial().extend({
  schemaVersion: z.literal(1),
  id: z.string().regex(SLUG),
  system: z.enum(["COC7", "TOUHOU"]),
  version: z.string().regex(SEMVER),
  extends: z.array(z.string().regex(PACK_REF)).min(1)
});

export type RulePackOverlay = z.input<typeof RulePackOverlaySchema>;

export type AttributeMethod = z.output<typeof AttributeMethodSchema>;

export type Skill = z.output<typeof SkillSchema>;

export type PresetTier = (typeof PRESET_TIERS)[number];
export type PresetAttributes = z.output<typeof PresetAttributesSchema>;
export type PresetCharacter = z.output<typeof PresetCharacterSchema>;
export type PresetCharacterInput = z.input<typeof PresetCharacterSchema>;

export type CombatEventRule = z.output<typeof CombatEventSchema>;
export type CombatRules = z.output<typeof CombatRulesSchema>;
export type CombatMode = (typeof COMBAT_MODES)[number];
