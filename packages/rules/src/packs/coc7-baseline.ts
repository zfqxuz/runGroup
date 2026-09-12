import type { RulePackInput } from "../schema";
import { COC7_EXTRA_SKILLS } from "./coc7-extra-skills";

/** COC7 基线包。只包含机制必需的值，东方扩展在其上叠加。 */
export const COC7_BASELINE: RulePackInput = {
  schemaVersion: 1,
  id: "coc7-baseline",
  system: "COC7",
  version: "1.1.0",
  const: {},
  attributes: {
    min: 15,
    max: 90,
    methods: [
      {
        kind: "ROLL_SETS",
        id: "destiny5",
        label: "天命 5 · 掷 5 组选 1 组",
        sets: 5,
        dice: "3d6",
        multiplier: 5
      },
      {
        kind: "POINT_BUY",
        id: "point480",
        label: "总点数 480 · 单项 15~90",
        total: 480,
        perAttributeMin: 15,
        perAttributeMax: 90
      },
      { kind: "MANUAL", id: "manual", label: "手动填写" }
    ]
  },
  derived: {
    maxHp: "floor((con + siz) / 10)",
    maxMp: "floor(pow / 5)",
    maxSan: "99 - CTHULHU_MYTHOS",
    maxDp: "floor(pow / 5)"
  },
  check: {
    criticalAt: "1",
    extremeDivisor: "5",
    hardDivisor: "2",
    fumbleFlat: "100",
    fumbleSkillBelow: "50",
    fumbleRangeFrom: "96",
    allowPush: true
  },
  atb: {
    tickMs: 250,
    max: "100",
    speed: "2 + dex / 10",
    actionCost: {
      // COC7 默认也支持 ATB 房间；攻击 / 施法必须有消耗，
      // 否则 ATB 溢出后会出现「未就绪但已满槽」并永久卡住。
      DANMAKU: "40",
      SPELLCARD: "60",
      DEFEND: "30",
      DODGE: "20",
      COUNTER: "50",
      ITEM: "30",
      PASS: "10",
      FLEE: "40"
    },
    tieBreak: "DEX_DESC"
  },
  damage: {
    pipeline: [
      "BASE_DICE",
      "ENHANCE_MOD",
      "DEFEND_REDUCE",
      "COUNTER_RESOLVE",
      "GRAZE_RESOLVE",
      "SHIELD_REDUCE",
      "CLAMP_MIN_ZERO"
    ],
    defend: { cost: "0", reduceMultiplier: "3" },
    dodge: { cost: "0", grazeMpGainRatio: "0" },
    // COC7 反击失败 = 攻击方正常命中，不做减半；1d6 不应该被 0.5 向下取整成 0。
    counter: { cost: "0", failDamageRatio: "1" }
  },
  // COC7 战斗：KP 每轮排定出手顺序，随后全员依次行动
  combat: {
    mode: "INITIATIVE",
    initiative: { key: "dex", tieBreak: "KP", kpAdjustsOrder: true },
    events: {
      COUNTER: {
        label: "反击",
        description: "近战被攻击时进行反击，与攻击方进行对抗；反击成功时化解本次攻击"
      },
      DEATH_AT_ZERO_HP: {
        label: "倒地判定",
        description: "HP 归零即失去战斗能力"
      },
      FUMBLE_CONSEQUENCE: {
        label: "大失败附加后果",
        description: "大失败时附带额外惩罚，而不只是失败"
      },
      MADNESS: {
        label: "临时疯狂",
        description: "单次理智损失过多时进入疯狂状态"
      }
    }
  }
};

/** COC7 标准技能表。东方模组开启时整表被替换。 */
COC7_BASELINE.skills = [
  { id: "FIGHTING_BRAWL", name: "格斗（斗殴）", category: "COMBAT", base: "25" },
  { id: "FIGHTING_AXE", name: "格斗（斧）", category: "COMBAT", base: "15" },
  { id: "FIREARMS_HANDGUN", name: "射击（手枪）", category: "COMBAT", base: "20" },
  { id: "FIREARMS_RIFLE", name: "射击（步枪/霰弹枪）", category: "COMBAT", base: "25" },
  { id: "FIREARMS_BOW", name: "射击（弓）", category: "COMBAT", base: "15" },
  { id: "DODGE", name: "闪避", category: "COMBAT", base: "dex / 2" },
  { id: "THROW", name: "投掷", category: "COMBAT", base: "20" },
  { id: "CLIMB", name: "攀爬", category: "PHYSICAL", base: "20" },
  { id: "JUMP", name: "跳跃", category: "PHYSICAL", base: "20" },
  { id: "SWIM", name: "游泳", category: "PHYSICAL", base: "20" },
  { id: "STEALTH", name: "潜行", category: "PHYSICAL", base: "20" },
  { id: "LISTEN", name: "聆听", category: "PHYSICAL", base: "20" },
  { id: "SPOT_HIDDEN", name: "侦查", category: "PHYSICAL", base: "25" },
  { id: "SLEIGHT_OF_HAND", name: "妙手", category: "PHYSICAL", base: "10" },
  { id: "LOCKSMITH", name: "锁匠", category: "PHYSICAL", base: "1" },
  { id: "DRIVE_AUTO", name: "汽车驾驶", category: "PHYSICAL", base: "20" },
  { id: "RIDE", name: "骑术", category: "PHYSICAL", base: "5" },
  { id: "FIRST_AID", name: "急救", category: "PHYSICAL", base: "30" },
  { id: "ACCOUNTING", name: "会计", category: "KNOWLEDGE", base: "5" },
  { id: "ANTHROPOLOGY", name: "人类学", category: "KNOWLEDGE", base: "1" },
  { id: "APPRAISE", name: "估价", category: "KNOWLEDGE", base: "5" },
  { id: "ARCHAEOLOGY", name: "考古学", category: "KNOWLEDGE", base: "1" },
  { id: "HISTORY", name: "历史", category: "KNOWLEDGE", base: "5" },
  { id: "LAW", name: "法律", category: "KNOWLEDGE", base: "5" },
  { id: "LIBRARY_USE", name: "图书馆使用", category: "KNOWLEDGE", base: "20" },
  { id: "MEDICINE", name: "医学", category: "KNOWLEDGE", base: "1" },
  { id: "NATURAL_WORLD", name: "博物学", category: "KNOWLEDGE", base: "10" },
  { id: "NAVIGATE", name: "导航", category: "KNOWLEDGE", base: "10" },
  { id: "OCCULT", name: "神秘学", category: "KNOWLEDGE", base: "5" },
  { id: "PSYCHOANALYSIS", name: "精神分析", category: "KNOWLEDGE", base: "1" },
  { id: "PSYCHOLOGY", name: "心理学", category: "KNOWLEDGE", base: "10" },
  { id: "SCIENCE", name: "科学", category: "KNOWLEDGE", base: "1" },
  { id: "CTHULHU_MYTHOS", name: "克苏鲁神话", category: "KNOWLEDGE", base: "0" },
  { id: "LANGUAGE_OWN", name: "母语", category: "KNOWLEDGE", base: "edu" },
  { id: "LANGUAGE_OTHER", name: "外语", category: "KNOWLEDGE", base: "1" },
  { id: "ELECTRONICS", name: "电子学", category: "TECH", base: "1" },
  { id: "COMPUTER_USE", name: "计算机使用", category: "TECH", base: "5" },
  { id: "ELECTRICAL_REPAIR", name: "电气维修", category: "TECH", base: "10" },
  { id: "MECHANICAL_REPAIR", name: "机械维修", category: "TECH", base: "10" },
  { id: "OPERATE_HEAVY_MACHINERY", name: "操作重型机械", category: "TECH", base: "1" },
  { id: "CHARM", name: "魅惑", category: "SOCIAL", base: "15" },
  { id: "FAST_TALK", name: "话术", category: "SOCIAL", base: "5" },
  { id: "INTIMIDATE", name: "恐吓", category: "SOCIAL", base: "15" },
  { id: "PERSUADE", name: "说服", category: "SOCIAL", base: "10" },
  { id: "CREDIT_RATING", name: "信用评级", category: "SOCIAL", base: "0" },
  { id: "DISGUISE", name: "乔装", category: "OTHER", base: "5" },
  { id: "TRACK", name: "追踪", category: "OTHER", base: "10" },
  { id: "SURVIVAL", name: "生存", category: "OTHER", base: "10" },
  { id: "ART_CRAFT", name: "艺术与手艺", category: "OTHER", base: "5" },
  ...COC7_EXTRA_SKILLS
];

COC7_BASELINE.presets = [
  {
    "id": "BYSTANDER",
    "name": "路人",
    "subtitle": "平民",
    "description": "街头巷尾的普通人，没有受过战斗训练。",
    "tier": "MINION",
    "rarity": "COMMON",
    "race": null,
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
      "PSYCHOLOGY": 20,
      "DODGE": 25,
      "PERSUADE": 20
    },
    "maxHp": 10,
    "maxMp": 10,
    "maxSan": 50,
    "maxDp": 10,
    "tags": [
      "HUMAN",
      "CIVILIAN"
    ]
  },
  {
    "id": "POLICE",
    "name": "巡警",
    "subtitle": "执法者",
    "description": "受过基本武器训练的执法者，能控制局面。",
    "tier": "STANDARD",
    "rarity": "UNCOMMON",
    "race": null,
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
      "FIGHTING_BRAWL": 60,
      "FIREARMS_HANDGUN": 60,
      "DODGE": 30,
      "INTIMIDATE": 50,
      "LAW": 40,
      "LISTEN": 50,
      "SPOT_HIDDEN": 55,
      "FIRST_AID": 40,
      "DRIVE_AUTO": 50
    },
    "maxHp": 12,
    "maxMp": 11,
    "maxSan": 55,
    "maxDp": 11,
    "tags": [
      "HUMAN",
      "LAW"
    ]
  },
  {
    "id": "FAIRY",
    "name": "妖精",
    "subtitle": "超自然生物",
    "description": "小型的超自然生物，脆弱但擅于躲藏与恶作剧。",
    "tier": "MINION",
    "rarity": "UNCOMMON",
    "race": null,
    "attributes": {
      "str": 15,
      "con": 25,
      "siz": 15,
      "dex": 75,
      "app": 55,
      "int": 30,
      "pow": 60,
      "edu": 5,
      "luck": 60
    },
    "skills": {
      "DODGE": 50,
      "STEALTH": 60,
      "SPOT_HIDDEN": 50,
      "LISTEN": 45,
      "THROW": 30,
      "JUMP": 30,
      "CLIMB": 25
    },
    "maxHp": 4,
    "maxMp": 12,
    "maxSan": 60,
    "maxDp": 12,
    "tags": [
      "FAIRY",
      "SUPERNATURAL"
    ]
  },
  {
    "id": "ELITE",
    "name": "强者",
    "subtitle": "精英",
    "description": "经验丰富、身体与意志都处于巅峰的对手。",
    "tier": "ELITE",
    "rarity": "RARE",
    "race": null,
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
      "FIGHTING_BRAWL": 80,
      "FIREARMS_HANDGUN": 75,
      "DODGE": 45,
      "SPOT_HIDDEN": 70,
      "PSYCHOLOGY": 55,
      "INTIMIDATE": 60,
      "STEALTH": 55,
      "FIRST_AID": 50
    },
    "maxHp": 13,
    "maxMp": 15,
    "maxSan": 75,
    "maxDp": 15,
    "tags": [
      "ELITE"
    ]
  }
];
