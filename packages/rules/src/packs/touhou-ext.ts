import type { RulePackOverlay } from "../schema";

/**
 * 东方扩展包。继承 COC7 基线，覆盖衍生公式 / ATB / 伤害管线，
 * 并补充种族、状态效果。
 */
export const TOUHOU_EXT: RulePackOverlay = {
  schemaVersion: 1,
  id: "touhou-ext",
  system: "TOUHOU",
  version: "1.1.0",
  extends: ["coc7-baseline@1.1.0"],
  const: {
    MP_PER_POW: 4,
    DP_BASE: 10,
    HP_COEFFICIENT: 4,
    DEFEND_REDUCE: 3,
    GRAZE_GAIN_RATIO: 0.5,
    /**
     * COC7 属性 → 千幻抄特性值的换算系数：特性值 = floor(COC7 属性 / ATTR_SCALE)。
     * 1 = 直接代入（默认）；10 = 约等于千幻抄原版量级。
     * 房间可由 KP 在准备页覆盖；只影响东方模式。
     */
    ATTR_SCALE: 1,
    /**
     * COC7 百分制技能 → 千幻抄技能等级的换算：技能等级 = floor(技能值 / SKILL_SCALE)。
     * 20 ≈ COC7 100 对应千幻抄 5 级。
     */
    SKILL_SCALE: 20,
    /**
     * 14.1 追逐换算：移动 m/s → 追逐 MOV。
     * 1 = 1 m/s 记 1 MOV（默认）；使用 ATTR_SCALE=1 原始属性量级的房间可调低。
     */
    TOUHOU_MOV_PER_MPS: 1
  },
  derived: {
    // 千幻抄：特性值 = floor(COC7 属性 / ATTR_SCALE)，HP = 10 + {耐久} × HP系数。
    maxHp: "ceil(10 + floor(con / ATTR_SCALE) * HP_COEFFICIENT)",
    maxMp: "floor(pow / ATTR_SCALE) * MP_PER_POW",
    maxSan: "floor(pow / ATTR_SCALE)",
    maxDp: "DP_BASE + floor(str / ATTR_SCALE) + floor(con / ATTR_SCALE) + floor(pow / ATTR_SCALE)"
  },
  atb: {
    tickMs: 250,
    max: "100",
    speed: "2 + dex / 10",
    actionCost: {
      DEFEND: "30",
      DODGE: "20",
      COUNTER: "50",
      ITEM: "30",
      PASS: "10",
      FLEE: "40",
      DANMAKU: "40",
      SPELLCARD: "60"
    },
    tieBreak: "DEX_DESC"
  },
  damage: {
    pipeline: [
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
    ],
    // 东方防御：先做近战技能对抗；成功免伤，失败按固定值减伤。cost 仅保留给旧规则包兼容。
    defend: { cost: "0", reduceMultiplier: "1", failReduce: "30" },
    // 擦弹不再直接回灵：成功回避在战斗层累积擦弹点数，玩家用 PASS 行动消费。
    dodge: { cost: "0", grazeMpGainRatio: "0" },
    counter: { cost: "20", failDamageRatio: "0.5" }
  }
};

TOUHOU_EXT.races = {
  HUMAN: {
    tier: "D",
    name: "人类",
    description: "最普通也最自由的种族。幸运 +15，兴趣技能点为智力×2.5，初始财产（信用）更高，但通常不可修习【妖术】。",
    attrMods: { luck: "15" },
    interestPoints: "int * 2.5",
    disallowedAbilityCategories: ["YOURIKI", "YOUJUTSU"],
    flags: ["NO_YOUJUTSU", "CREDIT_20"],
    abilities: [
      { id: "NO_YOUJUTSU", name: "不可修习妖术", description: "人类原则上不能习得【妖术】；KP 可用规则许可作为例外。", automated: false }
    ]
  },
  FAIRY: {
    tier: "D",
    name: "妖精",
    description: "自然现象的正体，力量与智力偏弱，却极为敏捷。元素法天赋极高，肉体死亡后一个月会自然再生。",
    attrMods: { str: "-5", int: "-5", dex: "15" },
    skillBonuses: { ELEMENTAL_MAGIC: "35" },
    flags: ["RESPAWN_MONTHLY", "NO_FOOD_REQUIRED"],
    abilities: [
      { id: "ELEMENT_AFFINITY", name: "属性亲和", description: "元素魔法天赋极高（由技能加值体现）。", automated: false },
      { id: "RESPAWN", name: "自然再生", description: "肉体死亡后约一个月会在自然现象中再度成形；战斗内不结算，由 KP 按剧本处理。", automated: false, tags: ["MONTHLY"] }
    ]
  },
  MAGICIAN: {
    tier: "C",
    name: "魔法使",
    description: "以魔法为原动力的妖怪。力量与体质偏弱，智力与意志极高，精于【魔法】与【符文】。",
    attrMods: { str: "-5", con: "-5", int: "15", pow: "15" },
    skillBonuses: { MAGIC: "25", RUNE: "20" },
    flags: ["NO_FOOD_REQUIRED", "CAN_USE_MAGIC"],
    abilities: [
      { id: "MAGIC_BONUS", name: "魔法/神术天赋", description: "修习【魔法】或神术·阴阳术时获得种族加值（由技能加值体现）。", automated: false, tags: ["MAGIC", "SPIRIT_ARTS"] },
      { id: "NO_FOOD", name: "无需进食", description: "以魔法为原动力，不需要普通饮食。", automated: false }
    ]
  },
  BEAST: {
    tier: "C",
    name: "妖兽",
    description: "动物化成的妖怪，身体能力较强，擅长【妖术】与野兽相关的行动。",
    attrMods: { str: "10", dex: "10", pow: "-5" },
    skillBonuses: { YOUJUTSU: "25" },
    flags: ["CAN_YOUJUTSU", "BEAST_TRAIT"],
    abilities: [
      { id: "ANIMAL_TALK", name: "动物会话", description: "可以与同类或动物沟通；具体范围由 KP 裁定。", automated: false },
      { id: "TRANSFORM", name: "变身", description: "可化为人形或兽形；叙事与检定由 KP 处理。", automated: false },
      { id: "NO_FOOD", name: "妖怪体质", description: "可以靠妖力维持，不依赖普通饮食。", automated: false }
    ]
  },
  KAPPA: {
    elements: ["WATER"],
    tier: "C",
    name: "河童",
    description: "住在水里的妖怪，掌握外界科技，擅长水系元素法。",
    attrMods: { con: "-5", int: "15", pow: "10" },
    skillBonuses: { ELEMENTAL_MAGIC: "30" },
    flags: ["KAPPA_WATER", "HIGH_TECH"],
    abilities: [
      { id: "WATER", name: "水栖", description: "水下活动自如；水中行动判定由 KP 裁定。", automated: false },
      { id: "HIGH_TECH", name: "文明利器", description: "能够使用与维修外界科技道具。", automated: false }
    ]
  },
  TSUKUMOGAMI: {
    tier: "C",
    name: "付丧神",
    description: "物品变化的妖怪。元素法天赋优秀，并具有与本体相关的特长。",
    skillBonuses: { ELEMENTAL_MAGIC: "25" },
    flags: ["OBJECT_BOUND", "NO_FOOD_REQUIRED"],
    abilities: [
      { id: "OBJECT_BOND", name: "本体绑定", description: "能力与本体物品相关；本体技能由 KP 与玩家共同确认。", automated: false },
      { id: "TRANSFORM", name: "变身", description: "可变为本体或人形；叙事与检定由 KP 处理。", automated: false },
      { id: "NO_FOOD", name: "无需进食", description: "付丧神不依赖普通饮食。", automated: false }
    ]
  },
  GHOST: {
    elements: ["DARK"],
    tier: "B",
    name: "亡灵",
    description: "死者的亡灵，可以幽体化。体质偏低，意志极高，擅长【妖术】。",
    attrMods: { con: "-5", pow: "20" },
    skillBonuses: { YOUJUTSU: "25" },
    flags: ["CAN_PHASE", "NO_FOOD_REQUIRED", "UNDEAD"],
    abilities: [
      { id: "PHASE", name: "幽体化", description: "可以穿透物理障碍；无法穿越的结界由 KP 裁定。", automated: false },
      { id: "MP_TO_HP", name: "灵力回 HP", description: "可消耗灵力回复 HP；由 KP 用数值面板或自由掷骰结算。", automated: false },
      { id: "NO_FOOD", name: "无需进食", description: "亡灵不依赖普通饮食。", automated: false }
    ]
  },
  YOUKAI: {
    tier: "B",
    name: "妖怪",
    description: "身体能力与妖力强悍的种族。擅长【妖术】，但面对魔法与神术/阴阳术时较为脆弱。",
    attrMods: { str: "10", con: "10", pow: "10" },
    skillBonuses: { YOUJUTSU: "40" },
    // 妖怪免费获得 3 级【妖术】（10.1 / 2.11）。
    freeAbilityLevels: { YOUJUTSU: 3 },
    flags: ["CAN_YOUJUTSU", "WEAK_TO_SPIRIT", "WEAK_TO_MAGIC"],
    abilities: [
      { id: "FREE_YOUJUTSU", name: "免费妖术", description: "妖怪默认获得一定等级的【妖术】（由技能加值体现）。", automated: false, tags: ["YOUJUTSU"] },
      {
        id: "SPIRIT_WEAKNESS",
        name: "神术弱点",
        description: "受到神术·阴阳术攻击时伤害提高。",
        automated: true,
        tags: ["SPIRIT_ARTS", "RITUAL"],
        params: { multiplier: "1.5" }
      },
      {
        id: "MAGIC_WEAKNESS",
        name: "魔法弱点",
        description: "受到魔法 / 元素魔法攻击时伤害提高。",
        automated: true,
        tags: ["MAGIC", "ELEMENTAL_MAGIC"],
        params: { multiplier: "1.5" }
      }
    ]
  },
  TENGU: {
    elements: ["WIND"],
    tier: "B",
    name: "天狗",
    description: "妖怪山上势力最大的种族之一，高速飞行与风系元素法的大师。",
    attrMods: { str: "5", con: "5", dex: "20" },
    skillBonuses: { ELEMENTAL_MAGIC: "25" },
    flags: ["CAN_FLY", "TENGU_TRAIT"],
    abilities: [
      { id: "BEAST_TRAIT", name: "妖兽特性", description: "拥有妖兽的部分特性（动物会话、变身等）。", automated: false },
      { id: "SOCIAL_BOND", name: "社会约束", description: "受天狗社会与戒律约束；由 KP 在叙事中处理。", automated: false },
      { id: "FLIGHT", name: "飞行", description: "可高速飞行；飞行检定使用 FLIGHT 技能。", automated: false, tags: ["FLIGHT"] }
    ]
  },
  VAMPIRE: {
    elements: ["DARK"],
    tier: "A",
    name: "吸血鬼",
    description: "能力很强但弱点也多的妖怪。力量、体质与意志优秀，擅长【妖术·吸血】。",
    attrMods: { str: "15", con: "10", pow: "10" },
    skillBonuses: { YOUJUTSU: "30" },
    flags: ["VAMPIRE_WEAKNESS", "CAN_YOUJUTSU"],
    abilities: [
      { id: "BLOOD_DRAIN", name: "吸血", description: "可吸收目标鲜血回复自身；由能力效果或 KP 裁定结算。", automated: false },
      { id: "CHARM", name: "魅惑", description: "对特定目标使用魅惑；检定与抵抗由 KP 裁定。", automated: false },
      {
        id: "SUNLIGHT_WEAKNESS",
        name: "阳光弱点",
        description: "暴露在阳光下（施加 SUNLIGHT 状态）时受到的伤害提高。",
        automated: true,
        tags: ["SUNLIGHT"],
        params: { multiplier: "1.5" }
      },
      { id: "BLOODTHIRST", name: "鲜血需求", description: "需要定期吸血；由 KP 按剧本处理。", automated: false }
    ]
  },
  ABERRATION: {
    tier: "B",
    name: "怪异",
    description: "无法归入既有分类的异常存在。可使用属性使能力，并具有持续再生能力。",
    flags: ["CAN_ELEMENTALIST", "REGENERATE"],
    abilities: [
      { id: "ELEMENTALIST", name: "属性使", description: "可习得【属性使】能力体系；由能力系统承接。", automated: false, tags: ["ELEMENTALIST"] },
      {
        id: "REGEN",
        name: "再生",
        description: "每轮结束时自动回复少量 HP。",
        automated: true,
        params: { amount: "2" }
      }
    ]
  },
  DEMON: {
    elements: ["DARK"],
    tier: "A",
    name: "恶魔",
    description: "来自异界的高位存在，擅长订立契约与黑暗视觉，但受契约内容约束。",
    attrMods: { pow: "10", app: "5" },
    flags: ["DEMON_CONTRACT", "DARKVISION"],
    abilities: [
      { id: "CONTRACT", name: "契约", description: "可与他者订立契约并获取相应代价 / 回报；条款由 KP 与玩家协商。", automated: false },
      { id: "DARKVISION", name: "黑暗视觉", description: "黑暗中可正常视物；由 KP 在探索场景中直接允许。", automated: false }
    ]
  },
  HOURAI: {
    name: "蓬莱人",
    description: "不老不死，无法被彻底杀死，但运气较差。",
    attrMods: { con: "10", luck: "-10" },
    flags: ["IMMORTAL"],
    abilities: [
      {
        id: "IMMORTAL",
        name: "不老不死",
        description: "HP 归零时不会真正死亡，而是以 1 HP 保留不死之身。",
        automated: true,
        params: { reviveHp: "1" }
      }
    ]
  },
  HANYOU: {
    name: "半妖",
    description: "兼具人与妖的特质，两头都不完全属于。",
    attrMods: { dex: "5", pow: "5", edu: "-5" },
    flags: ["CAN_YOUJUTSU"],
    abilities: [
      { id: "HALF_YOUKAI", name: "半妖体质", description: "可修习妖术，但受人类与妖怪双方的排斥；由 KP 在叙事中处理。", automated: false }
    ]
  }
};

/**
 * 千幻抄属性表。相克关系集中在这里，模组可整体覆盖。
 * strongAgainst: 本属性克制谁；weakTo: 本属性被谁克制（由相克关系反向生成）。
 */
TOUHOU_EXT.elements = {
  WOOD: { id: "WOOD", name: "木", strongAgainst: ["EARTH"], weakTo: ["METAL"] },
  FIRE: { id: "FIRE", name: "火", strongAgainst: ["METAL"], weakTo: ["WATER"] },
  EARTH: { id: "EARTH", name: "土", strongAgainst: ["WATER"], weakTo: ["WOOD", "WIND"] },
  METAL: { id: "METAL", name: "金", strongAgainst: ["WOOD"], weakTo: ["FIRE"] },
  WATER: { id: "WATER", name: "水", strongAgainst: ["FIRE"], weakTo: ["EARTH", "THUNDER", "ICE"] },
  WIND: { id: "WIND", name: "风", strongAgainst: ["EARTH"], weakTo: ["THUNDER", "ICE"] },
  THUNDER: { id: "THUNDER", name: "雷", strongAgainst: ["WIND", "WATER"], weakTo: [] },
  ICE: { id: "ICE", name: "冷气", strongAgainst: ["WATER", "WIND"], weakTo: [] },
  LIGHT: { id: "LIGHT", name: "光", strongAgainst: ["DARK"], weakTo: ["DARK"] },
  DARK: { id: "DARK", name: "暗", strongAgainst: ["LIGHT"], weakTo: ["LIGHT"] },
};

TOUHOU_EXT.elementRules = {
  enabled: true,
  // 弱点攻击 +2D；同属性攻击 -2D（千幻抄：固定伤害情形用 flat 值）。
  weaknessDamage: "2d6",
  weaknessFlat: "5",
  sameElementDamage: "2d6",
  sameElementFlat: "5",
  // 弱点 「抵抗 -3」；同属性「抵抗 +3」，映射到本次应对检定目标。
  weaknessResistMod: "-3",
  sameElementResistMod: "3"
};

/**
 * 千幻抄能力类别与逐级消费表。
 * 具体法术仍放在 magic.spells，通过 spell.abilityId / requiredLevel / activation / resist 接入。
 */
TOUHOU_EXT.abilities = {
  enabled: true,
  // 车卡能力点：A-D 分别为 30/25/20/15。
  pointBudgets: { A: 30, B: 25, C: 20, D: 15 },
  // 成长等级表（13.1）：特性值 / 技能 / 能力 / HP系数 & SC。
  growthRanks: {
    A: { attribute: 10, skill: 18, ability: 12, hpCoefficient: 0.8, spellcard: 0.7 },
    B: { attribute: 8, skill: 15, ability: 10, hpCoefficient: 0.6, spellcard: 0.6 },
    C: { attribute: 6, skill: 12, ability: 8, hpCoefficient: 0.4, spellcard: 0.5 },
    D: { attribute: 4, skill: 9, ability: 6, hpCoefficient: 0.2, spellcard: 0.4 },
    E: { attribute: 2, skill: 6, ability: 4, hpCoefficient: 0.1, spellcard: 0.3 },
    F: { attribute: 1, skill: 3, ability: 2, hpCoefficient: 0.1, spellcard: 0.1 }
  },
  categories: {
    SPIRIT_ARTS: {
      id: "SPIRIT_ARTS",
      name: "神术·阴阳术",
      description: "咏唱 + 单手结印发动；结界、降灵、驱魔。",
      activationAttribute: "int",
      costTable: [5, 10, 15, 20, 25, 25],
      spellsPerLevel: 2,
      // 7.1 术式版：消费更低（3/6/9/12/15/15），但不能用于射击 / 追击 / 弹幕。
      variants: {
        UTSUSHI: {
          id: "UTSUSHI",
          name: "术式版",
          description: "消费 3/6/9/12/15/15…；不能用于射击 / 追击 / 弹幕。",
          costTable: [3, 6, 9, 12, 15, 15],
          restrictedAttackKinds: ["RANGED", "CHASE", "DANMAKU"]
        }
      }
    },
    MAGIC: {
      id: "MAGIC",
      name: "魔法",
      description: "以魔导书习得；有抵抗与仪式魔法规则。",
      activationAttribute: "int",
      costTable: [5, 10, 15, 20, 25, 25],
      spellsPerLevel: 4
    },
    ELEMENTALIST: {
      id: "ELEMENTALIST",
      name: "属性使",
      description: "每种属性独立习得；可选 {知性} 或 {感觉} 作为发动特性。",
      activationAttribute: "int",
      costTable: [4, 8, 12, 16, 20, 20],
      spellsPerLevel: 0
    },
    YOUJUTSU: {
      id: "YOUJUTSU",
      name: "妖术",
      description: "妖怪专属；可与技能组合、妖弹化、常在化。",
      activationAttribute: "pow",
      costTable: [1, 2, 4, 6, 8, 10, 12, 12],
      spellsPerLevel: 0,
      // 10.2 妖弹化：消费 2/3/5…（已知前缀；更高等级待 wiki 法术表补齐）。
      variants: {
        DANMAKU: {
          id: "DANMAKU",
          name: "妖弹化",
          description: "把妖术妖弹化的变体消费表（2/3/5…，更高等级待补）。",
          costTable: [2, 3, 5]
        }
      }
    },
    YOURIKI: {
      id: "YOURIKI",
      name: "妖力",
      description: "支付消费习得后常时生效；各种族可免费获得特定妖力（10.1）。",
      activationAttribute: "pow",
      costTable: [1, 2, 4, 6, 8, 10, 12, 12],
      spellsPerLevel: 0
    },
    FEAT: {
      id: "FEAT",
      name: "特技",
      description: "多数常时有效；含【锻炼】，用于近战/武器伤害。",
      activationAttribute: "pow",
      costTable: [1, 2, 4, 6, 8, 10, 12, 12],
      spellsPerLevel: 0
    }
  }
};
/**
 * 7.5 结界系法术通用规则。
 *
 * 引擎已支持大小 / 等级 / 目标值 / 灵力消耗查表、持续、解除对抗、扩大缩小
 * 与结界内战斗惩罚；具体数值表（大小档位、每级 HP / MP / 目标值）属于 wiki
 * 内容，待补齐后在模组 / 规则包覆盖这里。当前只启用结构，法术卡仍用 effect.hp。
 */
TOUHOU_EXT.barrier = {
  enabled: true,
  sizes: {},
  levels: [],
  restack: "REPLACE",
  dispelNeedsContest: false
};
TOUHOU_EXT.statusEffects = {
  // 阳光暴露标记：吸血鬼的 SUNLIGHT_WEAKNESS 会读取这个 key。
  SUNLIGHT: { stack: "REFRESH", durationTicks: "240" },
  HASTE: { stack: "REFRESH", durationTicks: "240", speedMultiplier: "1.5" },
  SLOW: { stack: "REFRESH", durationTicks: "240", speedMultiplier: "0.5" },
  STOP: { stack: "REPLACE", durationTicks: "40", speedMultiplier: "0" },
  SHIELD: { stack: "STACK", maxStacks: 3, durationTicks: "120", damageMultiplier: "0.7" }
};

TOUHOU_EXT.spellcard = {
  declaration: {
    // 千幻抄：展开型 SC 的 HP 上限与使用者 HP 上限相同。
    hpRatio: "1",
    durationTicks: "720",
    onBreakClearDanmaku: true,
    clearTargets: "ALL"
  },
  consumption: { mpCost: "30", oncePerCombat: true },
  // 符卡战斗宣言：本场一方可用 SC 数 ≈ 能使用 SC 的人数 × 2~2.5。
  battleDeclaration: { perMember: 2.5, rounding: "CEIL", min: 1 },
  enhance: {
    MELEE: { accuracyMod: "5", damageMultiplier: "1.5" },
    DANMAKU: { damageFlat: "3", mpCostMod: "2" },
    SPELL: { abilityMod: "5" }
  },
  outOfRule: { mpCost: "20", sanCost: "1d3" }
};

/**
 * 东方模组技能表 —— 整体替换 COC7 标准技能表。
 * 深合并时数组是替换语义，所以这里写什么，玩家就看到什么。
 */
TOUHOU_EXT.skills = [
  { id: "NEGOTIATION", name: "交涉-通用", category: "SOCIAL", base: "5", description: "发放与查阅报纸、套话、一般交涉；可视为简易的图书馆使用 + 心理学" },
  { id: "ART_INSTRUMENT", name: "技艺-乐器", category: "OTHER", base: "5", description: "普通型用于演奏与乐器知识；幻想型可作为乐器相关的特殊能力使用" },
  { id: "DANMAKU", name: "战斗-弹幕", category: "COMBAT", base: "20", description: "幻想乡基础战斗技能；使用当前装备的弹幕武器进行一次远程攻击" },
  { id: "MELEE", name: "近战格斗", category: "COMBAT", base: "25" },
  { id: "DODGE", name: "闪避", category: "COMBAT", base: "dex / 2" },
  { id: "GRAZE", name: "擦弹", category: "COMBAT", base: "dex / 2", description: "贴身躲过弹幕并回复灵力" },
  { id: "RESIST", name: "抵抗", category: "COMBAT", base: "pow / 2", description: "抵抗能力 / 妖术 / 异常状态时使用；目标值由施术者能力等级与达成值决定" },
  { id: "THROW", name: "投掷", category: "COMBAT", base: "20" },
  { id: "SPIRIT_ARTS", name: "神术/阴阳术", category: "MAGIC", base: "5", description: "创建结界、降灵驱魔；幻想乡的巫女与道士所修之术" },
  { id: "MAGIC", name: "魔法", category: "MAGIC", base: "1", description: "按【魔法】体系学习与施放法术；需通过符文检定阅读魔导书" },
  { id: "RUNE", name: "语言-符文", category: "KNOWLEDGE", base: "1", description: "阅读魔导书、理解法术体系的判定基础" },
  { id: "PUPPETRY", name: "技艺-人偶", category: "OTHER", base: "5", description: "普通型用于制作与操纵人偶；幻想型可指挥人偶或使魔执行简单行动" },
  { id: "DIVINATION", name: "调查-占卜", category: "KNOWLEDGE", base: "5", description: "通过命盘、塔罗、易卦等神秘知识解读目标、时间、地点等调查对象" },
  { id: "NINJUTSU", name: "战斗-忍术", category: "PHYSICAL", base: "1", description: "隐密类技能的综合版；普通型广而不精，幻想型可设计原创忍法" },
  { id: "SCIENCE", name: "科学", category: "KNOWLEDGE", base: "1", description: "幻想乡内笼统合并的自然科学知识" },
  { id: "ELEMENTAL_MAGIC", name: "元素魔法", category: "MAGIC", base: "1", description: "火水木金土的术法" },
  { id: "SPELLCARD_CRAFT", name: "符卡构筑", category: "MAGIC", base: "1", description: "设计并展开符卡" },
  { id: "BARRIER", name: "结界术", category: "MAGIC", base: "1" },
  { id: "YOUJUTSU", name: "妖术", category: "MAGIC", base: "1", description: "妖怪专属；人类不可习得" },
  { id: "RITUAL", name: "神道仪式", category: "MAGIC", base: "1" },
  { id: "ALCHEMY", name: "炼金", category: "TECH", base: "1" },
  { id: "GENSOU_LORE", name: "幻想知识", category: "KNOWLEDGE", base: "5", description: "下分神术/阴阳术、魔法、元素法、妖术；用于了解相应领域与施法判定" },
  { id: "YOUKAI_STUDIES", name: "妖怪学", category: "KNOWLEDGE", base: "1" },
  { id: "HISTORY", name: "历史", category: "KNOWLEDGE", base: "5" },
  { id: "OCCULT", name: "神秘学", category: "KNOWLEDGE", base: "5" },
  { id: "NATURAL_WORLD", name: "博物学", category: "KNOWLEDGE", base: "10" },
  { id: "LIBRARY_USE", name: "图书馆使用", category: "KNOWLEDGE", base: "20" },
  { id: "MEDICINE", name: "医学", category: "KNOWLEDGE", base: "1" },
  { id: "LANGUAGE_OWN", name: "母语", category: "KNOWLEDGE", base: "edu" },
  { id: "LANGUAGE_OTHER", name: "外语", category: "KNOWLEDGE", base: "1" },
  { id: "FLIGHT", name: "战斗-飞行", category: "PHYSICAL", base: "20", description: "幻想乡基础行动技能；可表现为装备飞行、腾云驾雾、骑扫把等方式" },
  { id: "ATHLETICS", name: "运动", category: "PHYSICAL", base: "20", description: "千幻抄〈运动〉；14.1 地面移动速度与追逐速度检定使用。" },
  { id: "CLIMB", name: "攀爬", category: "PHYSICAL", base: "20" },
  { id: "STEALTH", name: "潜行", category: "PHYSICAL", base: "20" },
  { id: "LISTEN", name: "聆听", category: "PHYSICAL", base: "20" },
  { id: "SPOT_HIDDEN", name: "侦查", category: "PHYSICAL", base: "25" },
  { id: "FIRST_AID", name: "急救", category: "PHYSICAL", base: "30" },
  { id: "SWIM", name: "游泳", category: "PHYSICAL", base: "20" },
  { id: "PERFORM", name: "表演", category: "PHYSICAL", base: "5" },
  { id: "PERSUADE", name: "说服", category: "SOCIAL", base: "10" },
  { id: "CHARM", name: "魅惑", category: "SOCIAL", base: "15" },
  { id: "FAST_TALK", name: "话术", category: "SOCIAL", base: "5" },
  { id: "INTIMIDATE", name: "恐吓", category: "SOCIAL", base: "15" },
  { id: "CREDIT_RATING", name: "信用评级", category: "SOCIAL", base: "0" },
  { id: "CRAFT", name: "手工艺", category: "TECH", base: "5" },
  { id: "STEAL", name: "顺手牵羊", category: "OTHER", base: "10" },
  { id: "GAMBLE", name: "赌博", category: "OTHER", base: "10" }
];

/**
 * 东方战斗：ATB 全局计数器。事件表与 COC7 的三个底座合并
 * （record 在深合并时是逐键合并，array 才是替换）。
 */
TOUHOU_EXT.dp = {
  // 千幻抄：DP 回复 = ceil((知性 + 感觉)/3)，最低 2；平台把「感觉」映射为 DEX。
  regen: "ceil((floor(int / ATTR_SCALE) + floor(dex / ATTR_SCALE)) / 3)",
  minRegen: 2,
  maxDicePerCheck: 3,
  // 千幻抄行动消耗；模组 / 房间可覆盖。
  actionCosts: {
    danmaku: 3,
    rangedPerDie: 1,
    chasePerTarget: 2,
    meleeApproachPerDie: 1,
    meleeHitPerDie: 1,
    dodgePerDie: 1,
    defendPerDie: 1,
    abilityPerDie: 1,
    resistPerDie: 1,
    coverPerDie: 1,
    resistMaxDice: 3
  }
};

TOUHOU_EXT.combat = {
  // 千幻抄：东方扩展只使用 DP 模式（回合 → 宣言 → 逐个行动）。
  mode: "DP",
  initiative: { key: "dex", tieBreak: "KEY_DESC", kpAdjustsOrder: false },
  events: {
    GRAZE: {
      label: "擦弹",
      description: "闪避成功时免伤并回复相当于伤害一半的灵力",
      params: { gainRatio: "0.5" }
    },
    COUNTER: {
      label: "消弹对抗",
      description: "消耗灵力进行对抗，成功则双方弹幕抵消，失败吃一半伤害",
      params: { mpCost: "20", failDamageRatio: "0.5" }
    },
    SPELLCARD_BREAK_CLEARS_DANMAKU: {
      label: "符卡击破清弹",
      description: "展开型符卡被击破时清除场上弹幕",
      params: { othersOnly: "0" }
    },
    OUT_OF_RULE_SPELL: {
      label: "规则外施法",
      description: "相当于施放 COC 法术，同时消耗灵力与理智",
      params: { mpCost: "20" }
    },
    // 重伤 / 濒死按 COC7 规则书实现，东方包默认关闭；需要的房间可单独覆盖开启。
    MAJOR_WOUND: {
      label: "重伤（COC7）",
      description: "COC7 规则：单次伤害达到最大生命值一半时受伤，CON 失败昏迷；达到最大生命值立即死亡。东方房默认关闭",
      defaultEnabled: false
    },
    DYING: {
      label: "濒死（COC7）",
      description: "COC7 规则：受重伤且 HP 归零后每轮结束 CON 检定，失败死亡。东方房默认关闭",
      defaultEnabled: false
    }
  }
};

TOUHOU_EXT.presets = [
  {
    "id": "BYSTANDER",
    "name": "路人",
    "subtitle": "人里居民",
    "description": "幻想乡的普通居民，对异变见怪不怪。",
    "tier": "MINION",
    "rarity": "COMMON",
    "race": "HUMAN",
    "attributes": {
      "str": 50,
      "con": 50,
      "siz": 55,
      "dex": 50,
      "app": 50,
      "int": 55,
      "pow": 50,
      "edu": 55,
      "luck": 50
    },
    "skills": {
      "LISTEN": 30,
      "SPOT_HIDDEN": 30,
      "LIBRARY_USE": 25,
      "FIRST_AID": 25,
      "PERSUADE": 20,
      "DODGE": 25,
      "FLIGHT": 30,
      "GENSOU_LORE": 20
    },
    "maxHp": 10,
    "maxMp": 200,
    "maxSan": 50,
    "maxDp": 160,
    "tags": [
      "HUMAN",
      "CIVILIAN"
    ]
  },
  {
    "id": "POLICE",
    "name": "巡警",
    "subtitle": "人里警备",
    "description": "人里的巡警，负责维持村落秩序。",
    "tier": "STANDARD",
    "rarity": "UNCOMMON",
    "race": "HUMAN",
    "attributes": {
      "str": 60,
      "con": 60,
      "siz": 65,
      "dex": 55,
      "app": 50,
      "int": 55,
      "pow": 55,
      "edu": 60,
      "luck": 50
    },
    "skills": {
      "MELEE": 60,
      "DANMAKU": 45,
      "DODGE": 30,
      "GRAZE": 35,
      "SPOT_HIDDEN": 55,
      "LISTEN": 50,
      "INTIMIDATE": 50,
      "PERSUADE": 40,
      "FLIGHT": 50,
      "GENSOU_LORE": 30
    },
    "maxHp": 12,
    "maxMp": 220,
    "maxSan": 55,
    "maxDp": 185,
    "tags": [
      "HUMAN",
      "LAW"
    ]
  },
  {
    "id": "FAIRY",
    "name": "妖精",
    "subtitle": "自然的化身",
    "description": "自然之力凝聚的小妖精，活泼而难缠。",
    "tier": "MINION",
    "rarity": "UNCOMMON",
    "race": "FAIRY",
    "attributes": {
      "str": 15,
      "con": 25,
      "siz": 15,
      "dex": 70,
      "app": 45,
      "int": 20,
      "pow": 55,
      "edu": 5,
      "luck": 60
    },
    "skills": {
      "FLIGHT": 60,
      "DANMAKU": 55,
      "DODGE": 40,
      "GRAZE": 45,
      "ELEMENTAL_MAGIC": 50,
      "STEALTH": 50,
      "SPOT_HIDDEN": 45
    },
    "maxHp": 4,
    "maxMp": 220,
    "maxSan": 55,
    "maxDp": 105,
    "tags": [
      "FAIRY",
      "SUPERNATURAL"
    ]
  },
  {
    "id": "ELITE",
    "name": "强者",
    "subtitle": "妖怪中的强者",
    "description": "妖怪中的强者，拥有压倒性的身体与妖力。",
    "tier": "ELITE",
    "rarity": "RARE",
    "race": "YOUKAI",
    "attributes": {
      "str": 75,
      "con": 70,
      "siz": 65,
      "dex": 70,
      "app": 55,
      "int": 70,
      "pow": 75,
      "edu": 65,
      "luck": 50
    },
    "skills": {
      "MELEE": 80,
      "DANMAKU": 75,
      "DODGE": 45,
      "GRAZE": 50,
      "SPIRIT_ARTS": 60,
      "BARRIER": 50,
      "SPELLCARD_CRAFT": 60,
      "FLIGHT": 70,
      "GENSOU_LORE": 50
    },
    "maxHp": 13,
    "maxMp": 300,
    "maxSan": 75,
    "maxDp": 230,
    "tags": [
      "YOUKAI",
      "ELITE"
    ]
  }
];
