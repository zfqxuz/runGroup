import type { RulePackInput } from "../schema";

/** COC7 基线包。只包含机制必需的值，东方扩展在其上叠加。 */
export const COC7_BASELINE: RulePackInput = {
  schemaVersion: 1,
  id: "coc7-baseline",
  system: "COC7",
  version: "1.0.0",
  const: {},
  attributes: {
    min: 1,
    max: 99,
    rollMethod: "ROLL_3D6X5"
  },
  derived: {
    maxHp: "floor((con + siz) / 10)",
    maxMp: "floor(pow / 5)",
    maxSan: "pow",
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
    counter: { cost: "0", failDamageRatio: "0.5" }
  }
};
