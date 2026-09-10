export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

export type Node =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "var"; readonly name: string; readonly pos: number }
  | {
      readonly kind: "unary";
      readonly op: "-" | "+";
      readonly operand: Node;
      readonly pos: number;
    }
  | {
      readonly kind: "binary";
      readonly op: BinaryOp;
      readonly left: Node;
      readonly right: Node;
      readonly pos: number;
    }
  | {
      readonly kind: "ternary";
      readonly cond: Node;
      readonly then: Node;
      readonly other: Node;
      readonly pos: number;
    }
  | {
      readonly kind: "call";
      readonly name: string;
      readonly args: readonly Node[];
      readonly pos: number;
    };
