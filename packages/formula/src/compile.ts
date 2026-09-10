import type { Node } from "./ast";
import { FormulaError } from "./errors";
import { BUILTIN_FUNCTIONS, LAZY_FUNCTIONS } from "./functions";
import { DEFAULT_LIMITS, parse, type ParseLimits } from "./parser";

export interface CompileOptions extends Partial<ParseLimits> {
  readonly vars?: readonly string[];
  readonly consts?: readonly string[];
  readonly functions?: readonly string[];
}

export interface CompiledExpr {
  readonly source: string;
  readonly ast: Node;
  readonly vars: readonly string[];
  readonly consts: readonly string[];
  readonly functions: readonly string[];
}

const BUILTIN_NAMES: readonly string[] = [
  ...Object.keys(BUILTIN_FUNCTIONS),
  ...Object.keys(LAZY_FUNCTIONS)
];

export function walkAst(node: Node, visit: (node: Node) => void): void {
  visit(node);
  switch (node.kind) {
    case "unary":
      walkAst(node.operand, visit);
      break;
    case "binary":
      walkAst(node.left, visit);
      walkAst(node.right, visit);
      break;
    case "ternary":
      walkAst(node.cond, visit);
      walkAst(node.then, visit);
      walkAst(node.other, visit);
      break;
    case "call":
      for (const arg of node.args) walkAst(arg, visit);
      break;
    default:
      break;
  }
}

export function compile(source: string, options: CompileOptions = {}): CompiledExpr {
  const limits: ParseLimits = {
    maxDepth: options.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxNodes: options.maxNodes ?? DEFAULT_LIMITS.maxNodes
  };

  const varNames = new Set(options.vars ?? []);
  const constNames = new Set(options.consts ?? []);
  const allowedFunctions = new Set(options.functions ?? BUILTIN_NAMES);

  for (const name of varNames) {
    if (constNames.has(name)) {
      throw new FormulaError(
        "DUPLICATE_BINDING",
        `"${name}" is declared as both a variable and a constant`,
        { source, position: 0 }
      );
    }
  }

  const ast = parse(source, limits);
  const usedVars = new Set<string>();
  const usedConsts = new Set<string>();
  const usedFunctions = new Set<string>();
  const known = [...varNames, ...constNames].sort();

  walkAst(ast, (node) => {
    if (node.kind === "var") {
      if (node.name.startsWith("__")) {
        throw new FormulaError("RESERVED_IDENTIFIER", `"${node.name}" is a reserved identifier`, {
          source,
          position: node.pos
        });
      }
      if (varNames.has(node.name)) {
        usedVars.add(node.name);
      } else if (constNames.has(node.name)) {
        usedConsts.add(node.name);
      } else {
        throw new FormulaError("UNKNOWN_IDENTIFIER", `Unknown identifier "${node.name}"`, {
          source,
          position: node.pos,
          hint:
            known.length === 0
              ? "no variables or constants are declared in this scope"
              : `available: ${known.slice(0, 12).join(", ")}`
        });
      }
    }

    if (node.kind === "call") {
      const definition = BUILTIN_FUNCTIONS[node.name] ?? LAZY_FUNCTIONS[node.name];
      if (definition === undefined || !allowedFunctions.has(node.name)) {
        throw new FormulaError("UNKNOWN_FUNCTION", `Unknown function "${node.name}()"`, {
          source,
          position: node.pos,
          hint: `available: ${[...allowedFunctions].join(", ")}`
        });
      }
      if (node.args.length < definition.minArgs || node.args.length > definition.maxArgs) {
        const expected =
          definition.minArgs === definition.maxArgs
            ? `${definition.minArgs}`
            : `${definition.minArgs}..${definition.maxArgs}`;
        throw new FormulaError(
          "ARITY_MISMATCH",
          `${node.name}() expects ${expected} argument(s) but received ${node.args.length}`,
          { source, position: node.pos }
        );
      }
      usedFunctions.add(node.name);
    }
  });

  return {
    source,
    ast,
    vars: [...usedVars],
    consts: [...usedConsts],
    functions: [...usedFunctions]
  };
}
