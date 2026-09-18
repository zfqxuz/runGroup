import { FormulaError } from "./errors";
import { rollDie, type Rng } from "./rng";

export type DiceTerm =
  | {
      readonly kind: "dice";
      readonly sign: 1 | -1;
      readonly count: number;
      readonly sides: number;
    }
  | { readonly kind: "flat"; readonly sign: 1 | -1; readonly value: number };

export interface DiceExpression {
  readonly source: string;
  readonly terms: readonly DiceTerm[];
}

export interface DiceRollDetail {
  readonly sign: 1 | -1;
  readonly count: number;
  readonly sides: number;
  readonly values: readonly number[];
}

export interface DiceRollResult {
  readonly source: string;
  readonly total: number;
  readonly min: number;
  readonly max: number;
  readonly details: readonly DiceRollDetail[];
}

export const DICE_LIMITS = {
  maxTerms: 32,
  maxDicePerTerm: 100,
  maxTotalDice: 200,
  minSides: 2,
  maxSides: 1000
} as const;

const DICE_PATTERN = /^(\d*)d(\d+)$/i;
const FLAT_PATTERN = /^\d+$/;

const FULL_WIDTH_DIGITS: Readonly<Record<string, string>> = {
  "０": "0",
  "１": "1",
  "２": "2",
  "３": "3",
  "４": "4",
  "５": "5",
  "６": "6",
  "７": "7",
  "８": "8",
  "９": "9"
};

/** 把常见中文全角输入归一化成骰子表达式可解析的 ASCII 形式。 */
export function normalizeDiceExpression(source: string): string {
  let normalized = "";
  for (const ch of source) {
    const digit = FULL_WIDTH_DIGITS[ch];
    if (digit !== undefined) {
      normalized += digit;
      continue;
    }
    if (ch === "ｄ" || ch === "Ｄ") {
      normalized += "d";
      continue;
    }
    if (ch === "＋") {
      normalized += "+";
      continue;
    }
    if (ch === "－" || ch === "−" || ch === "—" || ch === "–") {
      normalized += "-";
      continue;
    }
    normalized += ch;
  }
  return normalized.trim();
}

export function parseDice(source: string): DiceExpression {
  const compact = source.replace(/\s+/g, "");
  if (compact.length === 0) {
    throw new FormulaError("EMPTY_EXPRESSION", "Dice expression is empty", { source, position: 0 });
  }

  const terms: DiceTerm[] = [];
  let totalDice = 0;
  let sign: 1 | -1 = 1;
  let buffer = "";
  let bufferStart = 0;

  const flush = (endPosition: number): void => {
    if (buffer.length === 0) {
      throw new FormulaError("INVALID_DICE_EXPRESSION", "Missing term between signs", {
        source,
        position: endPosition
      });
    }
    const diceMatch = DICE_PATTERN.exec(buffer);
    if (diceMatch) {
      const count = diceMatch[1] === "" ? 1 : Number(diceMatch[1]);
      const sides = Number(diceMatch[2]);
      if (count < 1 || count > DICE_LIMITS.maxDicePerTerm) {
        throw new FormulaError(
          "DICE_LIMIT_EXCEEDED",
          `Dice count must be 1..${DICE_LIMITS.maxDicePerTerm}, got ${count}`,
          { source, position: bufferStart }
        );
      }
      if (sides < DICE_LIMITS.minSides || sides > DICE_LIMITS.maxSides) {
        throw new FormulaError(
          "DICE_LIMIT_EXCEEDED",
          `Dice sides must be ${DICE_LIMITS.minSides}..${DICE_LIMITS.maxSides}, got ${sides}`,
          { source, position: bufferStart }
        );
      }
      totalDice += count;
      terms.push({ kind: "dice", sign, count, sides });
    } else if (FLAT_PATTERN.test(buffer)) {
      terms.push({ kind: "flat", sign, value: Number(buffer) });
    } else {
      throw new FormulaError("INVALID_DICE_EXPRESSION", `Cannot parse dice term "${buffer}"`, {
        source,
        position: bufferStart,
        hint: "expected NdM or a plain integer, e.g. 2d6+3"
      });
    }
    buffer = "";
  };

  for (let i = 0; i < compact.length; i += 1) {
    const ch = compact[i] as string;
    if (ch === "+" || ch === "-") {
      if (buffer.length > 0) flush(i);
      sign = ch === "-" ? -1 : 1;
      bufferStart = i + 1;
      continue;
    }
    if (buffer.length === 0) bufferStart = i;
    buffer += ch;
  }
  flush(compact.length);

  if (terms.length > DICE_LIMITS.maxTerms) {
    throw new FormulaError(
      "DICE_LIMIT_EXCEEDED",
      `Too many terms (max ${DICE_LIMITS.maxTerms})`,
      { source, position: 0 }
    );
  }
  if (totalDice > DICE_LIMITS.maxTotalDice) {
    throw new FormulaError(
      "DICE_LIMIT_EXCEEDED",
      `Too many dice in a single roll (max ${DICE_LIMITS.maxTotalDice})`,
      { source, position: 0 }
    );
  }

  return { source, terms };
}

export function diceBounds(expression: DiceExpression): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const term of expression.terms) {
    if (term.kind === "flat") {
      min += term.sign * term.value;
      max += term.sign * term.value;
      continue;
    }
    const low = term.count;
    const high = term.count * term.sides;
    if (term.sign > 0) {
      min += low;
      max += high;
    } else {
      min -= high;
      max -= low;
    }
  }
  return { min, max };
}

export function rollDice(expression: DiceExpression, rng: Rng): DiceRollResult {
  const bounds = diceBounds(expression);
  const details: DiceRollDetail[] = [];
  let total = 0;

  for (const term of expression.terms) {
    if (term.kind === "flat") {
      total += term.sign * term.value;
      continue;
    }
    const values: number[] = [];
    for (let i = 0; i < term.count; i += 1) {
      const rolled = rollDie(rng, term.sides);
      values.push(rolled);
      total += term.sign * rolled;
    }
    details.push({ sign: term.sign, count: term.count, sides: term.sides, values });
  }

  return { source: expression.source, total, min: bounds.min, max: bounds.max, details };
}

export interface PercentileRoll {
  readonly roll: number;
  readonly ones: number;
  readonly tens: readonly number[];
  readonly bonusDice: number;
  readonly penaltyDice: number;
  readonly detail: string;
}

/**
 * COC7 百分骰：个位 + 十位。
 * - 奖励骰：额外十位中取最低；
 * - 惩罚骰：额外十位中取最高；
 * - 奖励与惩罚先互相抵消；
 * - 00+0 与所有十位为 0、个位为 0 的情况都读作 100。
 */
export function rollPercentile(
  rng: Rng,
  bonusDice = 0,
  penaltyDice = 0
): PercentileRoll {
  const bonus = Math.max(0, Math.floor(bonusDice));
  const penalty = Math.max(0, Math.floor(penaltyDice));
  const cancel = Math.min(bonus, penalty);
  const effectiveBonus = bonus - cancel;
  const effectivePenalty = penalty - cancel;
  const extra = Math.max(effectiveBonus, effectivePenalty);

  const tensDice: number[] = [];
  for (let i = 0; i < extra + 1; i += 1) {
    tensDice.push((rollDie(rng, 10) - 1) * 10);
  }
  const ones = rollDie(rng, 10) - 1;

  const selectedTens =
    effectiveBonus > 0
      ? Math.min(...tensDice)
      : effectivePenalty > 0
        ? Math.max(...tensDice)
        : (tensDice[0] as number);

  const raw = selectedTens + ones;
  const roll = raw === 0 ? 100 : raw;
  const modifierText =
    effectiveBonus > 0
      ? "奖励骰 x" + effectiveBonus
      : effectivePenalty > 0
        ? "惩罚骰 x" + effectivePenalty
        : "无修正";
  const detail =
    "十位[" +
    tensDice.join(", ") +
    "]" +
    (extra > 0 ? " " + modifierText : "") +
    " → " +
    String(selectedTens).padStart(2, "0") +
    "+" +
    ones +
    " = " +
    roll;

  return {
    roll,
    ones,
    tens: tensDice,
    bonusDice: effectiveBonus,
    penaltyDice: effectivePenalty,
    detail
  };
}
