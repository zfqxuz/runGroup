export const ATTRIBUTE_KEYS = [
  "str",
  "con",
  "siz",
  "dex",
  "app",
  "int",
  "pow",
  "edu",
  "luck"
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type AttributeSet = Record<AttributeKey, number>;

export const DERIVED_KEYS = [
  "hp",
  "maxHp",
  "mp",
  "maxMp",
  "san",
  "maxSan",
  "dp",
  "maxDp"
] as const;

export type DerivedKey = (typeof DERIVED_KEYS)[number];
export type DerivedStats = Record<DerivedKey, number>;

export const CHECK_RESULTS = [
  "CRITICAL",
  "EXTREME",
  "HARD",
  "REGULAR",
  "FAIL",
  "FUMBLE"
] as const;

export type CheckResult = (typeof CHECK_RESULTS)[number];

/** 成功等级。用于对抗检定时比较，数值越大越好。 */
export const CHECK_RANK: Readonly<Record<CheckResult, number>> = {
  FUMBLE: 0,
  FAIL: 1,
  REGULAR: 2,
  HARD: 3,
  EXTREME: 4,
  CRITICAL: 5
};

export const DEFENSE_TYPES = ["PASS", "DEFEND", "DODGE", "COUNTER"] as const;
export type DefenseType = (typeof DEFENSE_TYPES)[number];
