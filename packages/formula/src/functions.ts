export class FormulaDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaDomainError";
  }
}

export interface FunctionDef {
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly call: (args: readonly number[]) => number;
}

const at = (args: readonly number[], index: number): number => args[index] as number;

const positive = (value: number, label: string): number => {
  if (value <= 0) {
    throw new FormulaDomainError(`${label} requires a positive argument, got ${value}`);
  }
  return value;
};

export const BUILTIN_FUNCTIONS: Readonly<Record<string, FunctionDef>> = {
  floor: { minArgs: 1, maxArgs: 1, call: (a) => Math.floor(at(a, 0)) },
  ceil: { minArgs: 1, maxArgs: 1, call: (a) => Math.ceil(at(a, 0)) },
  round: { minArgs: 1, maxArgs: 1, call: (a) => Math.round(at(a, 0)) },
  trunc: { minArgs: 1, maxArgs: 1, call: (a) => Math.trunc(at(a, 0)) },
  abs: { minArgs: 1, maxArgs: 1, call: (a) => Math.abs(at(a, 0)) },
  sign: { minArgs: 1, maxArgs: 1, call: (a) => Math.sign(at(a, 0)) },
  sqrt: {
    minArgs: 1,
    maxArgs: 1,
    call: (a) => Math.sqrt(positive(at(a, 0), "sqrt"))
  },
  exp: { minArgs: 1, maxArgs: 1, call: (a) => Math.exp(at(a, 0)) },
  log: {
    minArgs: 1,
    maxArgs: 1,
    call: (a) => Math.log(positive(at(a, 0), "log"))
  },
  log10: {
    minArgs: 1,
    maxArgs: 1,
    call: (a) => Math.log10(positive(at(a, 0), "log10"))
  },
  pow: { minArgs: 2, maxArgs: 2, call: (a) => Math.pow(at(a, 0), at(a, 1)) },
  mod: {
    minArgs: 2,
    maxArgs: 2,
    call: (a) => {
      const divisor = at(a, 1);
      if (divisor === 0) throw new FormulaDomainError("modulo by zero");
      return at(a, 0) % divisor;
    }
  },
  min: { minArgs: 1, maxArgs: 8, call: (a) => Math.min(...a) },
  max: { minArgs: 1, maxArgs: 8, call: (a) => Math.max(...a) },
  clamp: {
    minArgs: 3,
    maxArgs: 3,
    call: (a) => {
      const value = at(a, 0);
      const low = at(a, 1);
      const high = at(a, 2);
      if (low > high) throw new FormulaDomainError("clamp: low bound is greater than high bound");
      return Math.min(Math.max(value, low), high);
    }
  }
};

/** 惰性求值函数：分支不参与求值，用于规避 1/0 之类的假阳性。 */
export const LAZY_FUNCTIONS: Readonly<Record<string, { minArgs: number; maxArgs: number }>> = {
  if: { minArgs: 3, maxArgs: 3 }
};
