import type { BinaryOp, Node } from "./ast";
import { FormulaError } from "./errors";
import { tokenize, type Token, type TokenKind } from "./token";

const BINARY_PRECEDENCE: Partial<Record<TokenKind, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6
};

export interface ParseLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export const DEFAULT_LIMITS: ParseLimits = { maxDepth: 32, maxNodes: 256 };

class Parser {
  private index = 0;
  private nodes = 0;
  private readonly tokens: readonly Token[];
  private readonly source: string;
  private readonly limits: ParseLimits;

  constructor(tokens: readonly Token[], source: string, limits: ParseLimits) {
    this.tokens = tokens;
    this.source = source;
    this.limits = limits;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    const tail = this.peek();
    if (tail.kind !== "eof") {
      throw new FormulaError("UNEXPECTED_TOKEN", `Unexpected trailing input "${tail.text}"`, {
        source: this.source,
        position: tail.pos
      });
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.index += 1;
    return token;
  }

  private expect(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new FormulaError(
        "UNEXPECTED_TOKEN",
        `Expected "${kind}" but found "${token.text || token.kind}"`,
        { source: this.source, position: token.pos }
      );
    }
    return this.advance();
  }

  private track<T extends Node>(node: T): T {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      throw new FormulaError(
        "EXPRESSION_TOO_LARGE",
        `Expression exceeds ${this.limits.maxNodes} nodes`,
        { source: this.source, position: 0 }
      );
    }
    return node;
  }

  private parseExpression(depth: number): Node {
    if (depth > this.limits.maxDepth) {
      throw new FormulaError(
        "EXPRESSION_TOO_DEEP",
        `Expression nesting exceeds ${this.limits.maxDepth}`,
        { source: this.source, position: this.peek().pos }
      );
    }
    return this.parseTernary(depth);
  }

  private parseTernary(depth: number): Node {
    const cond = this.parseBinary(0, depth);
    if (this.peek().kind !== "?") return cond;
    const question = this.peek();
    this.advance();
    const thenBranch = this.parseExpression(depth + 1);
    this.expect(":");
    const otherBranch = this.parseExpression(depth + 1);
    return this.track({ kind: "ternary", cond, then: thenBranch, other: otherBranch, pos: question.pos });
  }

  private parseBinary(minPrecedence: number, depth: number): Node {
    let left = this.parseUnary(depth);
    for (;;) {
      const token = this.peek();
      const precedence = BINARY_PRECEDENCE[token.kind];
      if (precedence === undefined || precedence < minPrecedence) return left;
      this.advance();
      const right = this.parseBinary(precedence + 1, depth + 1);
      left = this.track({ kind: "binary", op: token.kind as BinaryOp, left, right, pos: token.pos });
    }
  }

  private parseUnary(depth: number): Node {
    const token = this.peek();
    if (token.kind === "-" || token.kind === "+") {
      this.advance();
      const operand = this.parseUnary(depth + 1);
      return this.track({ kind: "unary", op: token.kind, operand, pos: token.pos });
    }
    return this.parsePower(depth);
  }

  private parsePower(depth: number): Node {
    const base = this.parsePrimary(depth);
    const caret = this.peek();
    if (caret.kind !== "^") return base;
    this.advance();
    const exponent = this.parseUnary(depth + 1);
    return this.track({ kind: "call", name: "pow", args: [base, exponent], pos: caret.pos });
  }

  private parsePrimary(depth: number): Node {
    const token = this.peek();

    if (token.kind === "num") {
      this.advance();
      return this.track({ kind: "num", value: token.num });
    }

    if (token.kind === "ident") {
      this.advance();
      if (this.peek().kind !== "(") {
        return this.track({ kind: "var", name: token.text, pos: token.pos });
      }
      this.advance();
      const args: Node[] = [];
      if (this.peek().kind !== ")") {
        args.push(this.parseExpression(depth + 1));
        while (this.peek().kind === ",") {
          this.advance();
          args.push(this.parseExpression(depth + 1));
        }
      }
      this.expect(")");
      return this.track({ kind: "call", name: token.text, args, pos: token.pos });
    }

    if (token.kind === "(") {
      this.advance();
      const inner = this.parseExpression(depth + 1);
      this.expect(")");
      return inner;
    }

    throw new FormulaError(
      token.kind === "eof" ? "UNEXPECTED_EOF" : "UNEXPECTED_TOKEN",
      token.kind === "eof" ? "Unexpected end of expression" : `Unexpected "${token.text}"`,
      { source: this.source, position: token.pos }
    );
  }
}

export function parse(source: string, limits: ParseLimits = DEFAULT_LIMITS): Node {
  if (source.trim().length === 0) {
    throw new FormulaError("EMPTY_EXPRESSION", "Expression is empty", { source, position: 0 });
  }
  return new Parser(tokenize(source), source, limits).parse();
}
