import type { RulePackOverlay } from "../schema";

/**
 * 东方扩展包。继承 COC7 基线，覆盖衍生公式 / ATB / 伤害管线，
 * 并补充种族、状态效果。
 */
export const TOUHOU_EXT: RulePackOverlay = {
  schemaVersion: 1,
  id: "touhou-ext",
  system: "TOUHOU",
  version: "1.0.0",
  extends: ["coc7-baseline@1.0.0"],
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
  HUMAN: { attrMods: { luck: "15" }, flags: ["NO_YOUJUTSU"] },
  FAIRY: {
    attrMods: { str: "-5", int: "-5", dex: "15" },
    skillBonuses: { ELEMENTAL_MAGIC: "35" },
    flags: ["RESPAWN_MONTHLY"]
  },
  MAGICIAN: { flags: ["NO_FOOD_REQUIRED"] },
  YOUKAI: { flags: ["CAN_YOUJUTSU"] },
  GHOST: { flags: ["CAN_PHASE"] }
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
