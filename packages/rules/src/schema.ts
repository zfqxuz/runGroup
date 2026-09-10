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

export const RaceSchema = z.object({
  /** 显示名，例如「妖精」。id 是 key，玩家看到的是这个。 */
  name: z.string(),
  description: z.string().optional(),
  attrMods: z.record(z.string(), ExprSchema).default({}),
  derivedOverrides: z.record(z.string(), ExprSchema).default({}),
  skillBonuses: z.record(z.string(), ExprSchema).default({}),
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

  damage: DamageRulesSchema,
  races: z.record(z.string(), RaceSchema).default({}),
  skills: z.array(SkillSchema).default([]),
  skillPoints: z
    .object({
      /** 职业技能点，公式只能用属性，例如 "edu * 4"。 */
      occupation: ExprSchema,
      /** 兴趣技能点，例如 "int * 2"。 */
      interest: ExprSchema,
      /** 车卡时的单项上限。 */
      maxAtCreation: ExprSchema
    })
    .default({ occupation: "edu * 4", interest: "int * 2", maxAtCreation: "70" }),
  statusEffects: z.record(z.string(), StatusEffectSchema).default({}),
  spellcard: SpellCardRulesSchema.optional(),

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
