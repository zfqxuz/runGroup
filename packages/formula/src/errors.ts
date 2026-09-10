/**
 * 表达式引擎错误。
 *
 * 设计约束：所有错误都必须带 `position`，因为配置错误必须能精确定位到
 * 用户写的那一行 JSON —— 「加载即校验，fail-fast」是本平台的地基原则。
 */
export type FormulaErrorCode =
  | 'EMPTY_EXPRESSION'
  | 'UNEXPECTED_TOKEN'
  | 'UNEXPECTED_EOF'
  | 'UNKNOWN_IDENTIFIER'
  | 'UNKNOWN_FUNCTION'
  | 'ARITY_MISMATCH'
  | 'DUPLICATE_BINDING'
  | 'RESERVED_IDENTIFIER'
  | 'EXPRESSION_TOO_DEEP'
  | 'EXPRESSION_TOO_LARGE'
  | 'INVALID_NUMBER'
  | 'DIVISION_BY_ZERO'
  | 'MATH_DOMAIN'
  | 'INVALID_DICE_EXPRESSION'
  | 'DICE_LIMIT_EXCEEDED'
  | 'INVALID_RNG_RANGE';

export interface FormulaErrorInit {
  readonly position: number;
  readonly source: string;
  readonly hint?: string;
}

export class FormulaError extends Error {
  readonly code: FormulaErrorCode;
  readonly position: number;
  readonly source: string;
  readonly hint: string | undefined;

  constructor(code: FormulaErrorCode, message: string, init: FormulaErrorInit) {
    super(`${message} (at position ${init.position} of "${init.source}")`);
    this.name = 'FormulaError';
    this.code = code;
    this.position = init.position;
    this.source = init.source;
    this.hint = init.hint;
    if (init.hint !== undefined) {
      this.message = `${this.message}\n  hint: ${init.hint}`;
    }
  }
}

/** 生成 `^` 定位串，用于 CLI / 配置错误面板展示。 */
export function caretLine(source: string, position: number): string {
  const clamped = Math.max(0, Math.min(position, source.length));
  return `${' '.repeat(clamped)}^`;
}
