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
  "RACE_MOD",
  "ELEMENT_MOD",
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

/**
 * 种族特殊能力。
 *
 * 千幻抄的种族能力既有「能自动结算的被动」也有「必须由 KP 裁定的叙事能力」。
 * automated=true 的条目由战斗引擎按 id 结算；false 的条目只作为规则提示展示，
 * 由 KP 用现有掷骰 / 面板 / 局内状态处理。
 */
export const RaceAbilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** 是否由规则 / 战斗引擎自动结算。 */
  automated: z.boolean().default(false),
  /**
   * 自动结算的触发标签。
   * - 技能弱点：填技能 id（如 SPIRIT_ARTS、MAGIC）；
   * - 状态弱点：填状态 key（如 SUNLIGHT）。
   */
  tags: z.array(z.string()).default([]),
  /** 自动化参数；数值公式可引用属性与规则包常量。 */
  params: z.record(z.string(), ExprSchema).default({})
});

export const RaceSchema = z.object({
  /** 显示名，例如「妖精」。id 是 key，玩家看到的是这个。 */
  name: z.string(),
  description: z.string().optional(),
  /** 千幻抄种族等级：A 最强 ~ D 最普通。非 wiki 种族（蓬莱人 / 半妖）留空。 */
  tier: z.enum(["A", "B", "C", "D"]).optional(),
  attrMods: z.record(z.string(), ExprSchema).default({}),
  derivedOverrides: z.record(z.string(), ExprSchema).default({}),
  skillBonuses: z.record(z.string(), ExprSchema).default({}),
  /** 种族专属兴趣点公式；缺省时使用规则包全局 skillPoints.interest。 */
  interestPoints: ExprSchema.optional(),
  /** 结构化种族能力。 */
  abilities: z.array(RaceAbilitySchema).default([]),
  /** 先天元素亲和 / 抗性；用于属性相克判定。 */
  elements: z.array(z.string()).default([]),
  /** 旧字段：仍被 UI/其他逻辑读取的扁平 flag 列表。 */
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
    reduceMultiplier: ExprSchema,
    /** 防御失败时的固定减伤表达式；缺省时沿用 cost×reduceMultiplier 的旧行为。 */
    failReduce: ExprSchema.optional()
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
export const MAGIC_TARGETINGS = ["SELF", "ALLY", "ENEMY", "ANY"] as const;
export const MAGIC_EFFECT_TYPES = [
  "DAMAGE",
  "HEAL",
  "MP_RESTORE",
  "MP_DRAIN",
  "SAN_LOSS",
  "SAN_RESTORE",
  "STATUS",
  "ARMOR",
  "SUMMON",
  "POSSESS",
  "DOT",
  "STUN",
  "CONTROL",
  "CLEANSE",
  "DISPEL"
] as const;

/** 按能力等级缩放伤害 / 治疗的公共字段（LvD / +Lv）。 */
const LevelScalingShape = {
  /** 每 perLevel 级追加 1 颗 die 面骰。 */
  levelDice: z
    .object({
      die: z.number().int().min(2).max(100),
      perLevel: z.number().int().min(1).default(1)
    })
    .optional(),
  /** 按能力等级追加固定值表达式；可用 abilityLv 变量。 */
  levelBonus: ExprSchema.optional()
};

/** 通用法术效果指令。规则包只描述「做什么」，战斗引擎负责结算。 */
export const MagicEffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DAMAGE"),
    amount: DiceExprSchema,
    /** 元素属性 id；命中弱点 / 同属性时由战斗层应用属性相克。 */
    element: z.string().optional(),
    ...LevelScalingShape
  }),
  z.object({
    type: z.literal("HEAL"),
    amount: DiceExprSchema,
    ...LevelScalingShape
  }),
  z.object({
    type: z.literal("MP_RESTORE"),
    amount: ExprSchema
  }),
  z.object({
    type: z.literal("MP_DRAIN"),
    amount: ExprSchema
  }),
  z.object({
    type: z.literal("SAN_LOSS"),
    amount: DiceExprSchema
  }),
  z.object({
    type: z.literal("SAN_RESTORE"),
    amount: ExprSchema
  }),
  z.object({
    type: z.literal("STATUS"),
    key: z.string(),
    stacks: ExprSchema.default("1")
  }),
  z.object({
    type: z.literal("ARMOR"),
    /** 获得护甲点数；护甲按 1:1 吸收伤害后扣减。 */
    amount: DiceExprSchema,
    /** 持续行动轮次；0 表示直到护甲耗尽或战斗结束。 */
    durationTicks: ExprSchema.default("0")
  }),
  z.object({
    type: z.literal("SUMMON"),
    /** 召唤物名字；服务端按这个名字查找房间内的独立 NPC 卡。 */
    name: z.string().default("召唤物"),
    /** 稳定召唤 key；用于不同译名 / 显示名之间的匹配。 */
    key: z.string().optional(),
    /** 直接指定房间内 NPC 卡的 id；存在时优先使用。 */
    cardId: z.string().optional(),
    count: ExprSchema.default("1"),
    /** 持续行动轮次；0 表示直到战斗结束。 */
    durationTicks: ExprSchema.default("0")
  }),
  z.object({
    type: z.literal("POSSESS"),
    /** 夺舍充能池格数：每经过 1 个战斗轮次或 1 次被夺舍 Token 移动消耗 1 格。 */
    durationTurns: ExprSchema.default("1")
  }),
  z.object({
    type: z.literal("DOT"),
    amount: DiceExprSchema,
    durationTicks: ExprSchema.default("3"),
    key: z.string().optional()
  }),
  z.object({
    type: z.literal("STUN"),
    durationActions: ExprSchema.default("1")
  }),
  z.object({
    type: z.literal("CONTROL"),
    durationActions: ExprSchema.default("1")
  }),
  z.object({
    type: z.literal("CLEANSE"),
    keys: z.array(z.string()).default([])
  }),
  z.object({
    type: z.literal("DISPEL"),
    /** 要驱散的状态 key；空数组表示驱散目标身上所有状态。 */
    keys: z.array(z.string()).default([]),
    /** 是否同时击破目标正在展开的符卡。 */
    declaration: z.boolean().default(false)
  })
]);

export const MagicSpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 施法检定使用的技能 id；COC7 缺省用 OCCULT，东方缺省用 MAGIC。 */
  skill: z.string().default("MAGIC"),
  description: z.string().optional(),
  mpCost: ExprSchema.default("0"),
  sanCost: DiceExprSchema.default("0"),
  /** 兼容旧数据：等价于一个 DAMAGE 效果。 */
  damage: DiceExprSchema.optional(),
  /** 法术默认元素；单个效果可用自己的 element 覆盖。 */
  element: z.string().optional(),
  /** 千幻抄能力 id（对应 abilities.categories）；存在时走能力发动流程。 */
  abilityId: z.string().optional(),
  /** 发动该法术所需的能力等级。 */
  requiredLevel: z.number().int().min(1).optional(),
  /** 发动判定覆盖；缺省使用能力类别的 activationAttribute + 3D6 + 目标 12。 */
  activation: z
    .object({
      /** 判定属性 key（str/con/siz/dex/app/int/pow/edu/luck）。 */
      attribute: z.string().optional(),
      /** 3D6 达成值 / 1D100 掷低。千幻抄默认 3D6。 */
      dice: z.enum(["3D6", "1D100"]).default("3D6"),
      /** 附加修正表达式。 */
      modifier: ExprSchema.default("0"),
      /** 3D6 模式下需要达到的目标值。 */
      target: ExprSchema.default("12")
    })
    .optional(),
  /** 抵抗判定；缺省无抵抗。 */
  resist: z
    .object({
      /** 抵抗方使用的属性 key。 */
      attribute: z.string().default("pow"),
      /** 抵抗方使用的技能 id。 */
      skill: z.string().default("RESIST"),
      dice: z.enum(["3D6", "1D100"]).default("3D6")
    })
    .optional(),
  target: z.enum(["SELF", "ONE", "ALL"]).default("ONE"),
  /** 目标阵营；不填时根据效果自动推断。 */
  targeting: z.enum(MAGIC_TARGETINGS).optional(),
  /** 通用效果指令集，按数组顺序结算。 */
  effects: z.array(MagicEffectSchema).default([])
});

export const MagicRulesSchema = z.object({
  enabled: z.boolean().default(false),
  system: z.enum(["COC7", "TOUHOU"]).optional(),
  spells: z.array(MagicSpellSchema).default([])
});

/** 元素定义；相克关系用 id 描述，天然支持模组自定义属性表。 */
export const ElementSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** 此属性克制（对目标造成弱点伤害）的属性 id。 */
  strongAgainst: z.array(z.string()).default([]),
  /** 此属性被哪些属性克制；用于反向查询，可与 strongAgainst 互为补充。 */
  weakTo: z.array(z.string()).default([])
});

/**
 * 属性相克规则。伤害加减值由战斗层掷好后写入管线，
 * 这里只保存「用什么骰 / 固定值」。
 */
export const ElementRulesSchema = z.object({
  enabled: z.boolean().default(true),
  /** 弱点攻击附加的伤害骰；无法掷骰时回退到 weaknessFlat。 */
  weaknessDamage: DiceExprSchema.default("2d6"),
  weaknessFlat: ExprSchema.default("5"),
  /** 同属性攻击的伤害惩罚骰；无法掷骰时回退到 sameElementFlat。 */
  sameElementDamage: DiceExprSchema.default("2d6"),
  sameElementFlat: ExprSchema.default("5"),
  /** 弱点攻击时防守方本次应对检定的目标修正。 */
  weaknessResistMod: ExprSchema.default("-3"),
  /** 同属性攻击时防守方本次应对检定的目标修正。 */
  sameElementResistMod: ExprSchema.default("3")
});

/** 千幻抄能力类别：神术·阴阳术 / 魔法 / 属性使 / 妖力与妖术 / 特技。 */
export const AbilityCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** 发动判定默认使用的特性值 key。 */
  activationAttribute: z.string().default("int"),
  /** 逐级习得消费点：第 n 级取 costTable[n-1]，超出取最后一档。 */
  costTable: z.array(z.number().int().nonnegative()).min(1),
  /** 每级可习得法术数；0 表示不限。 */
  spellsPerLevel: z.number().int().nonnegative().default(0)
});

/** 成长等级表的一行：分配给某分类后获得的成长量。 */
export const GrowthRankSchema = z.object({
  attribute: z.number().nonnegative(),
  skill: z.number().nonnegative(),
  ability: z.number().nonnegative(),
  /** HP 系数成长量；小数保留，HP 计算时向上取整。 */
  hpCoefficient: z.number().nonnegative(),
  /** SC 持有数成长量；小数保留，实际持有数向下取整。 */
  spellcard: z.number().nonnegative()
});

export const AbilityRulesSchema = z.object({
  enabled: z.boolean().default(false),
  categories: z.record(z.string(), AbilityCategorySchema).default({}),
  /** 车卡能力点预算：grade（A-D）-> 能力点。千幻抄为 30/25/20/15。 */
  pointBudgets: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** 成长等级表：A-F -> 四类成长量。 */
  growthRanks: z.record(z.string(), GrowthRankSchema).default({})
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
  /** 符卡战斗开始前的 SC 宣言：本场一方可用 SC 数按人数自动计算。 */
  battleDeclaration: z
    .object({
      /** 每名「可使用 SC 的成员」对应的本场可用数（千幻抄约 2~2.5）。 */
      perMember: z.number().positive().default(2.5),
      rounding: z.enum(["CEIL", "ROUND", "FLOOR"]).default("CEIL"),
      min: z.number().int().positive().default(1)
    })
    .default({}),
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
  }),
  z.object({
    kind: z.literal("FIXED_ARRAY"),
    id: z.string(),
    label: z.string(),
    /** 八项属性可分配值；玩家需要把这些值一一分配到八项属性上。 */
    values: z.array(z.number().int().min(0).max(999)).length(8),
    /** 幸运生成方式，默认 3d6×5。 */
    luckDice: z.string().default("3d6"),
    luckMultiplier: z.number().int().min(1).default(5)
  })
]);

/**
 * 战斗模式。
 *
 * INITIATIVE — COC7：KP 每轮排定出手顺序，随后全员依次行动。
 * ATB        — 东方：全局计数器推进，谁进度先满谁行动。
 */
export const COMBAT_MODES = ["INITIATIVE", "ATB", "DP"] as const;

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

/** 千幻抄 DP（Dice Pool）战斗规则。 */
export const DpActionCostsSchema = z.object({
  /** 弹幕：固定 DP 消耗，无判定、打全体。 */
  danmaku: z.number().int().nonnegative().default(3),
  /** 射击：每颗判定骰的 DP 消耗。 */
  rangedPerDie: z.number().int().nonnegative().default(1),
  /** 追击：每个目标的 DP 消耗。 */
  chasePerTarget: z.number().int().nonnegative().default(2),
  /** 近战：接近判定每颗骰的 DP 消耗。 */
  meleeApproachPerDie: z.number().int().nonnegative().default(1),
  /** 近战：命中判定每颗骰的 DP 消耗。 */
  meleeHitPerDie: z.number().int().nonnegative().default(1),
  /** 回避：每颗判定骰的 DP 消耗。 */
  dodgePerDie: z.number().int().nonnegative().default(1),
  /** 防御：每颗判定骰的 DP 消耗。 */
  defendPerDie: z.number().int().nonnegative().default(1),
  /** 能力发动：每颗判定骰的 DP 消耗（千幻抄能力判定最多 3D）。 */
  abilityPerDie: z.number().int().nonnegative().default(1),
  /** 抵抗：每颗判定骰的 DP 消耗。 */
  resistPerDie: z.number().int().nonnegative().default(1),
  /** 掩护 / 身代：每颗判定骰的 DP 消耗。 */
  coverPerDie: z.number().int().nonnegative().default(1),
  /** 抵抗：一次最多可用的 DP 骰。 */
  resistMaxDice: z.number().int().nonnegative().default(3)
});

export const DpRulesSchema = z.object({
  /** 每回合开始回复的 DP 表达式；千幻抄 = ceil((知性+感觉)/3)。平台把「感觉」映射为 DEX。 */
  regen: ExprSchema.default("ceil((int + dex) / 3)"),
  /** 最低回复量。 */
  minRegen: z.number().int().nonnegative().default(2),
  /** 一次判定最多消费的 DP 骰（能力 / 抵抗为 3）。 */
  maxDicePerCheck: z.number().int().positive().default(3),
  /** 各行动的 DP 消耗；可被模组 / 房间 ruleOverride 覆盖。 */
  actionCosts: DpActionCostsSchema.default({})
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
    pushCost: ExprSchema.optional(),
    skillImprovement: z
      .object({
        /** 完整版 7e：96–100 必定成长；入门版应覆盖为 false。 */
        autoPassFrom96: z.boolean().default(true)
      })
      .default({ autoPassFrom96: true })
  }),

  chargen: z
    .object({
      mode: z.enum(["CORE_OCCUPATION", "STARTER_QUICKSTART"]).default("CORE_OCCUPATION"),
      starter: z
        .object({
          attributeArray: z.array(z.number().int()).length(8).default([40, 50, 50, 50, 60, 60, 70, 80]),
          skillValues: z.array(z.number().int()).length(9).default([70, 60, 60, 50, 50, 50, 40, 40, 40]),
          interestCount: z.number().int().min(0).default(4),
          interestBonus: z.number().int().min(0).default(20),
          allowMythosAtCreation: z.boolean().default(false)
        })
        .optional()
    })
    .default({ mode: "CORE_OCCUPATION" }),

  magicPoint: z
    .object({
      overflowToHp: z.boolean().default(true),
      hpPerMp: z.number().int().positive().default(1)
    })
    .default({ overflowToHp: true, hpPerMp: 1 }),

  atb: z.object({
    tickMs: z.number().int().min(50).max(2000),
    max: ExprSchema,
    speed: ExprSchema,
    actionCost: z.record(z.enum(ACTION_COST_KEYS), ExprSchema).default({}),
    tieBreak: z.enum(["DEX_DESC", "RANDOM"]).default("DEX_DESC")
  }),

  combat: CombatRulesSchema,
  /** DP 模式专用规则；其他模式忽略。 */
  dp: DpRulesSchema.default({}),
  damage: DamageRulesSchema,
  /** 元素表：key 为元素 id（推荐大写，如 FIRE / WATER）。 */
  elements: z.record(z.string(), ElementSchema).default({}),
  elementRules: ElementRulesSchema.default({}),
  abilities: AbilityRulesSchema.default({}),
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
export type Element = z.output<typeof ElementSchema>;
export type ElementRules = z.output<typeof ElementRulesSchema>;
export type AbilityCategory = z.output<typeof AbilityCategorySchema>;
export type AbilityRules = z.output<typeof AbilityRulesSchema>;
export type GrowthRank = z.output<typeof GrowthRankSchema>;
export type RaceAbility = z.output<typeof RaceAbilitySchema>;
export type Race = z.output<typeof RaceSchema>;
export type StatusEffectRule = z.output<typeof StatusEffectSchema>;
export type DamageRules = z.output<typeof DamageRulesSchema>;
export type SpellCardRules = z.output<typeof SpellCardRulesSchema>;
export type MagicSpell = z.output<typeof MagicSpellSchema>;
export type MagicRules = z.output<typeof MagicRulesSchema>;
export type MagicEffect = z.output<typeof MagicEffectSchema>;
export type MagicTargeting = (typeof MAGIC_TARGETINGS)[number];
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
export type DpRules = z.output<typeof DpRulesSchema>;
export type DpActionCosts = z.output<typeof DpActionCostsSchema>;
export type CombatMode = (typeof COMBAT_MODES)[number];
