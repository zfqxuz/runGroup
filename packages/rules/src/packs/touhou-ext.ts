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
    DEFEND_REDUCE: 3,
    GRAZE_GAIN_RATIO: 0.5
  },
  derived: {
    maxHp: "floor((con + siz) / 10)",
    maxMp: "pow * MP_PER_POW",
    maxSan: "pow",
    maxDp: "DP_BASE + str + con + pow"
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
      "DEFEND_REDUCE",
      "COUNTER_RESOLVE",
      "GRAZE_RESOLVE",
      "SHIELD_REDUCE",
      "CLAMP_MIN_ZERO"
    ],
    defend: { cost: "10", reduceMultiplier: "DEFEND_REDUCE" },
    dodge: { cost: "0", grazeMpGainRatio: "GRAZE_GAIN_RATIO" },
    counter: { cost: "20", failDamageRatio: "0.5" }
  }
};

TOUHOU_EXT.races = {
  HUMAN: {
    name: "人类",
    description: "最普通也最自由的种族。幸运 +15，但无法修习妖术。",
    attrMods: { luck: "15" },
    flags: ["NO_YOUJUTSU"]
  },
  FAIRY: {
    name: "妖精",
    description: "力量与智力偏弱，却极其敏捷。元素魔法天赋极高，濒死后一个月重生。",
    attrMods: { str: "-5", int: "-5", dex: "15" },
    derivedOverrides: { maxHp: "-2" },
    skillBonuses: { ELEMENTAL_MAGIC: "35" },
    flags: ["RESPAWN_MONTHLY"]
  },
  MAGICIAN: {
    name: "魔法使",
    description: "习得特定魔法后可以不进食、不衰老。",
    flags: ["NO_FOOD_REQUIRED"]
  },
  YOUKAI: {
    name: "妖怪",
    description: "漫长的寿命与强大的妖力。可修习妖术。",
    attrMods: { edu: "-5", pow: "5" },
    flags: ["CAN_YOUJUTSU"]
  },
  GHOST: {
    name: "幽灵",
    description: "可幽体化，物理手段难以完全消灭。",
    attrMods: { con: "-5", pow: "5" },
    flags: ["CAN_PHASE"]
  },
  TENGU: {
    name: "天狗",
    description: "高速飞行与风系术法的大师。但高傲，社交上吃亏。",
    attrMods: { dex: "10", app: "-5" },
    skillBonuses: { FLIGHT: "25" },
    flags: ["CAN_FLY"]
  },
  VAMPIRE: {
    name: "吸血鬼",
    description: "恐怖的力量与妖力。昼伏夜出，惧怕阳光。",
    attrMods: { str: "10", pow: "10", con: "-5" },
    skillBonuses: { MELEE: "15" },
    flags: ["WEAK_TO_SUNLIGHT"]
  },
  HOURAI: {
    name: "蓬莱人",
    description: "不老不死，无法被彻底杀死。但运气极差。",
    attrMods: { con: "10", luck: "-10" },
    flags: ["IMMORTAL"]
  },
  HANYOU: {
    name: "半妖",
    description: "兼具人与妖的特质，两头都不完全属于。",
    attrMods: { dex: "5", pow: "5", edu: "-5" },
    flags: ["CAN_YOUJUTSU"]
  },
  TSUKUMOGAMI: {
    name: "付丧神",
    description: "器物化成的付丧神，与自身依附之物共鸣。",
    attrMods: { siz: "-10", dex: "5" },
    skillBonuses: { CRAFT: "20" },
    flags: ["OBJECT_BOUND"]
  }
};
TOUHOU_EXT.statusEffects = {
  HASTE: { stack: "REFRESH", durationTicks: "240", speedMultiplier: "1.5" },
  SLOW: { stack: "REFRESH", durationTicks: "240", speedMultiplier: "0.5" },
  STOP: { stack: "REPLACE", durationTicks: "40", speedMultiplier: "0" },
  SHIELD: { stack: "STACK", maxStacks: 3, durationTicks: "120", damageMultiplier: "0.7" }
};

TOUHOU_EXT.spellcard = {
  declaration: {
    hpRatio: "2",
    durationTicks: "720",
    onBreakClearDanmaku: true,
    clearTargets: "ALL"
  },
  consumption: { mpCost: "30", oncePerCombat: true },
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
  { id: "DANMAKU", name: "弹幕射击", category: "COMBAT", base: "20", description: "以弹幕进行远程攻击" },
  { id: "MELEE", name: "近战格斗", category: "COMBAT", base: "25" },
  { id: "DODGE", name: "闪避", category: "COMBAT", base: "dex / 2" },
  { id: "GRAZE", name: "擦弹", category: "COMBAT", base: "dex / 2", description: "贴身躲过弹幕并回复灵力" },
  { id: "THROW", name: "投掷", category: "COMBAT", base: "20" },
  { id: "SPIRIT_ARTS", name: "灵术", category: "MAGIC", base: "5", description: "操纵灵力进行攻防" },
  { id: "ELEMENTAL_MAGIC", name: "元素魔法", category: "MAGIC", base: "1", description: "火水木金土的术法" },
  { id: "SPELLCARD_CRAFT", name: "符卡构筑", category: "MAGIC", base: "1", description: "设计并展开符卡" },
  { id: "BARRIER", name: "结界术", category: "MAGIC", base: "1" },
  { id: "YOUJUTSU", name: "妖术", category: "MAGIC", base: "1", description: "妖怪专属；人类不可习得" },
  { id: "RITUAL", name: "神道仪式", category: "MAGIC", base: "1" },
  { id: "ALCHEMY", name: "炼金", category: "TECH", base: "1" },
  { id: "GENSOU_LORE", name: "幻想知识", category: "KNOWLEDGE", base: "5", description: "对幻想乡人、地、事的了解" },
  { id: "YOUKAI_STUDIES", name: "妖怪学", category: "KNOWLEDGE", base: "1" },
  { id: "HISTORY", name: "历史", category: "KNOWLEDGE", base: "5" },
  { id: "OCCULT", name: "神秘学", category: "KNOWLEDGE", base: "5" },
  { id: "NATURAL_WORLD", name: "博物学", category: "KNOWLEDGE", base: "10" },
  { id: "LIBRARY_USE", name: "图书馆使用", category: "KNOWLEDGE", base: "20" },
  { id: "MEDICINE", name: "医学", category: "KNOWLEDGE", base: "1" },
  { id: "LANGUAGE_OWN", name: "母语", category: "KNOWLEDGE", base: "edu" },
  { id: "LANGUAGE_OTHER", name: "外语", category: "KNOWLEDGE", base: "1" },
  { id: "FLIGHT", name: "飞行", category: "PHYSICAL", base: "20", description: "幻想乡的常识：大家都会飞" },
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
TOUHOU_EXT.combat = {
  mode: "ATB",
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
