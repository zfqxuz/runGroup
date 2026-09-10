import type { Node } from "./ast";
import type { CompiledExpr } from "./compile";
import { FormulaError } from "./errors";
import { BUILTIN_FUNCTIONS, FormulaDomainError } from "./functions";

export interface EvalContext {
  readonly vars?: Readonly<Record<string, number>>;
  readonly consts?: Readonly<Record<string, number>>;
}

type BinaryNode = Extract<Node, { kind: "binary" }>;
type CallNode = Extract<Node, { kind: "call" }>;

export function evaluate(expression: CompiledExpr, context: EvalContext = {}): number {
  return evaluateNode(expression.ast, context, expression.source);
}

export function evaluateNode(node: Node, context: EvalContext, source = "<inline>"): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var":
      return resolve(node.name, node.pos, context, source);
    case "unary": {
      const value = evaluateNode(node.operand, context, source);
      return node.op === "-" ? -value : value;
    }
    case "ternary": {
      const condition = evaluateNode(node.cond, context, source);
      if (condition !== 0) return evaluateNode(node.then, context, source);
      return evaluateNode(node.other, context, source);
    }
    case "binary":
      return evaluateBinary(node, context, source);
    case "call":
      return evaluateCall(node, context, source);
  }
}

function resolve(
  name: string,
  position: number,
  context: EvalContext,
  source: string
): number {
  const fromVars = context.vars?.[name];
  if (fromVars !== undefined) return fromVars;
  const fromConsts = context.consts?.[name];
  if (fromConsts !== undefined) return fromConsts;
  throw new FormulaError(
    "UNKNOWN_IDENTIFIER",
    `Missing value for "${name}" at evaluation time`,
    { source, position }
  );
}

function evaluateBinary(node: BinaryNode, context: EvalContext, source: string): number {
  const left = evaluateNode(node.left, context, source);

  if (node.op === "&&") {
    if (left === 0) return 0;
    return evaluateNode(node.right, context, source) !== 0 ? 1 : 0;
  }
  if (node.op === "||") {
    if (left !== 0) return 1;
    return evaluateNode(node.right, context, source) !== 0 ? 1 : 0;
  }

  const right = evaluateNode(node.right, context, source);

  switch (node.op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new FormulaError("DIVISION_BY_ZERO", "Division by zero", {
          source,
          position: node.pos,
          hint: "guard it, e.g. if(divisor == 0, 0, value / divisor)"
        });
      }
      return left / right;
    case "%":
      if (right === 0) {
        throw new FormulaError("DIVISION_BY_ZERO", "Modulo by zero", { source, position: node.pos });
      }
      return left % right;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
  }
}

function evaluateCall(node: CallNode, context: EvalContext, source: string): number {
  if (node.name === "if") {
    const condition = evaluateNode(node.args[0] as Node, context, source);
    const branch = condition !== 0 ? node.args[1] : node.args[2];
    return evaluateNode(branch as Node, context, source);
  }

  const definition = BUILTIN_FUNCTIONS[node.name];
  if (definition === undefined) {
    throw new FormulaError("UNKNOWN_FUNCTION", `Unknown function "${node.name}()"`, {
      source,
      position: node.pos
    });
  }

  const args = node.args.map((arg) => evaluateNode(arg, context, source));
  try {
    return definition.call(args);
  } catch (error) {
    if (error instanceof FormulaDomainError) {
      throw new FormulaError("MATH_DOMAIN", error.message, { source, position: node.pos });
    }
    throw error;
  }
}
