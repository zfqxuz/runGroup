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
