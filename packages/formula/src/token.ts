import { FormulaError } from './errors';

export type TokenKind =
  | 'num'
  | 'ident'
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '('
  | ')'
  | ','
  | '?'
  | ':'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly num: number;
  readonly pos: number;
}

/** 感叹号字符。源码里不直接写它，避免被工具层的 shell 预处理吞掉。 */
const UNARY_BANG = String.fromCharCode(33);

const TWO_CHAR = ['<=', '>=', '==', '!=', '&&', '||'] as const;
const ONE_CHAR = '+ - * / % ^ ( ) , ? : < >'.split(' ');

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isIdentStart = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const isIdentPart = (ch: string): boolean => isIdentStart(ch) || isDigit(ch);

const isTwoChar = (s: string): s is (typeof TWO_CHAR)[number] =>
  (TWO_CHAR as readonly string[]).includes(s);
const isOneChar = (ch: string): ch is TokenKind => ONE_CHAR.includes(ch);

/**
 * 词法分析。
 *
 * 标识符允许点号（race.hpMod），因为 RulePack 天然是嵌套的。
 * 注意 1d6 会被切成 num(1) + ident(d6) —— 这不是 bug：Expr 里禁止骰子，
 * 骰子必须走 DiceExpr，这样「纯函数」与「依赖 RNG」的边界才是硬的。
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] as string;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      let seenDot = false;
      while (i < source.length) {
        const c = source[i] as string;
        if (isDigit(c)) {
          i += 1;
        } else if (c === "." && !seenDot) {
          seenDot = true;
          i += 1;
        } else {
          break;
        }
      }
      const text = source.slice(start, i);
      const num = Number(text);
      if (!Number.isFinite(num)) {
        throw new FormulaError("INVALID_NUMBER", `Invalid number literal "${text}"`, {
          source,
          position: start
        });
      }
      tokens.push({ kind: "num", text, num, pos: start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && isIdentPart(source[i] as string)) i += 1;
      while (source[i] === ".") {
        const afterDot = source[i + 1];
        if (afterDot === undefined || !isIdentStart(afterDot)) {
          throw new FormulaError("UNEXPECTED_TOKEN", "Identifier cannot end with a dot", {
            source,
            position: i
          });
        }
        i += 1;
        while (i < source.length && isIdentPart(source[i] as string)) i += 1;
      }
      tokens.push({ kind: "ident", text: source.slice(start, i), num: 0, pos: start });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (isTwoChar(two)) {
      tokens.push({ kind: two, text: two, num: 0, pos: i });
      i += 2;
      continue;
    }

    if (isOneChar(ch)) {
      tokens.push({ kind: ch, text: ch, num: 0, pos: i });
      i += 1;
      continue;
    }

    if (ch === UNARY_BANG) {
      throw new FormulaError("UNEXPECTED_TOKEN", "Unexpected bang operator", {
        source,
        position: i,
        hint: "use the not-equal operator instead"
      });
    }
    if (ch === "=") {
      throw new FormulaError("UNEXPECTED_TOKEN", "Unexpected equals sign", {
        source,
        position: i,
        hint: "assignment is not allowed in formulas; use double equals for equality"
      });
    }
    if (ch === "&" || ch === "|") {
      throw new FormulaError("UNEXPECTED_TOKEN", `Unexpected "${ch}"`, {
        source,
        position: i,
        hint: "logical operators need two characters"
      });
    }

    throw new FormulaError("UNEXPECTED_TOKEN", `Unexpected character "${ch}"`, {
      source,
      position: i
    });
  }

  tokens.push({ kind: "eof", text: "", num: 0, pos: source.length });
  return tokens;
}
