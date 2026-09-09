import {
  pickJsonSource,
  resolveNodeKey,
} from "../../utils/referenceResolution";
import type { ReferenceNode } from "../../utils/referenceResolution";

export interface ExpressionContext {
  $json: unknown;
  $nodes?: Record<string, unknown>;
  $state?: Record<string, unknown>;
  nodes?: ReferenceNode[];
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} at position ${position}`);
    this.name = "ExpressionError";
  }
}

type TokenKind =
  | "number"
  | "string"
  | "identifier"
  | "operator"
  | "punctuation"
  | "eof";
interface Token {
  kind: TokenKind;
  value: string;
  position: number;
}
type Ast =
  | { kind: "literal"; value: unknown; position: number }
  | { kind: "root"; name: "$json" | "$nodes" | "$state"; position: number }
  | { kind: "node"; name: string; position: number }
  | {
      kind: "member";
      object: Ast;
      key: string | number;
      position: number;
      memberDepth: number;
    }
  | { kind: "unary"; operator: "!" | "-"; value: Ast; position: number }
  | {
      kind: "binary";
      operator: string;
      left: Ast;
      right: Ast;
      position: number;
    };

const MAX_INPUT = 4000;
const MAX_DEPTH = 32;
const MAX_NODES = 500;
const MAX_MEMBERS = 12;
const MAX_STRING = 1000;
const BLOCKED_IDENTIFIERS = new Set([
  "process",
  "require",
  "globalThis",
  "this",
  "import",
  "new",
]);
const BLOCKED_MEMBERS = new Set(["__proto__", "prototype", "constructor"]);
const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "===": 3,
  "!==": 3,
  ">": 4,
  ">=": 4,
  "<": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "`") throw new ExpressionError(`Unexpected token "${c}"`, i);
    if (c === "'" || c === '"') {
      const start = i++;
      let value = "";
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") {
          i++;
          if (i >= source.length)
            throw new ExpressionError("Unterminated string literal", start);
          const escaped: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            "\\": "\\",
            "'": "'",
            '"': '"',
          };
          value += escaped[source[i]] ?? source[i];
          i++;
        } else value += source[i++];
        if (value.length > MAX_STRING)
          throw new ExpressionError("String literal limit exceeded", start);
      }
      if (source[i] !== c)
        throw new ExpressionError("Unterminated string literal", start);
      i++;
      tokens.push({ kind: "string", value, position: start });
      continue;
    }
    const number = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({ kind: "number", value: number[0], position: i });
      i += number[0].length;
      continue;
    }
    const identifier = source.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0], position: i });
      i += identifier[0].length;
      continue;
    }
    const op = [
      "===",
      "!==",
      ">=",
      "<=",
      "&&",
      "||",
      "==",
      "!=",
      "++",
      "=>",
      ">",
      "<",
      "!",
      "+",
      "-",
      "*",
      "/",
      "%",
    ].find((candidate) => source.startsWith(candidate, i));
    if (op) {
      if (op === "++" || op === "=>")
        throw new ExpressionError(`Unexpected token "${op}"`, i);
      tokens.push({ kind: "operator", value: op, position: i });
      i += op.length;
      continue;
    }
    if (".[]()".includes(c)) {
      tokens.push({ kind: "punctuation", value: c, position: i++ });
      continue;
    }
    throw new ExpressionError(`Unexpected token "${c}"`, i);
  }
  tokens.push({ kind: "eof", value: "", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nodes = 0;
  constructor(private readonly tokens: Token[]) {}
  parse(): Ast {
    const result = this.expression(0, 1);
    const end = this.peek();
    if (end.kind !== "eof")
      throw new ExpressionError(
        `Unexpected token "${end.value}"`,
        end.position,
      );
    return result;
  }
  private peek() {
    return this.tokens[this.index];
  }
  private take(value?: string) {
    const token = this.tokens[this.index];
    if (value && token.value !== value)
      throw new ExpressionError(`Expected "${value}"`, token.position);
    this.index++;
    return token;
  }
  private make<T extends Ast>(node: T, depth: number): T {
    if (++this.nodes > MAX_NODES)
      throw new ExpressionError("AST node limit exceeded", node.position);
    if (depth > MAX_DEPTH)
      throw new ExpressionError("AST depth limit exceeded", node.position);
    return node;
  }
  private expression(min: number, depth: number): Ast {
    let left = this.prefix(depth);
    while (
      this.peek().kind === "operator" &&
      (PRECEDENCE[this.peek().value] ?? -1) >= min
    ) {
      const operator = this.take();
      const precedence = PRECEDENCE[operator.value];
      const right = this.expression(precedence + 1, depth + 1);
      left = this.make(
        {
          kind: "binary",
          operator: operator.value,
          left,
          right,
          position: operator.position,
        },
        depth,
      );
    }
    return left;
  }
  private prefix(depth: number): Ast {
    const token = this.peek();
    let result: Ast;
    if (
      token.kind === "operator" &&
      (token.value === "!" || token.value === "-")
    ) {
      this.take();
      result = this.make(
        {
          kind: "unary",
          operator: token.value,
          value: this.prefix(depth + 1),
          position: token.position,
        },
        depth,
      );
    } else if (token.value === "(") {
      this.take();
      result = this.expression(0, depth + 1);
      this.take(")");
    } else if (token.kind === "number") {
      this.take();
      result = this.make(
        {
          kind: "literal",
          value: Number(token.value),
          position: token.position,
        },
        depth,
      );
    } else if (token.kind === "string") {
      this.take();
      result = this.make(
        { kind: "literal", value: token.value, position: token.position },
        depth,
      );
    } else if (token.kind === "identifier") result = this.rootOrLiteral(depth);
    else
      throw new ExpressionError(
        `Unexpected token "${token.value}"`,
        token.position,
      );
    return this.members(result, depth);
  }
  private rootOrLiteral(depth: number): Ast {
    const token = this.take();
    if (
      token.value === "true" ||
      token.value === "false" ||
      token.value === "null"
    )
      return this.make(
        {
          kind: "literal",
          value: token.value === "null" ? null : token.value === "true",
          position: token.position,
        },
        depth,
      );
    if (BLOCKED_IDENTIFIERS.has(token.value))
      throw new ExpressionError(
        `Identifier "${token.value}" is not allowed`,
        token.position,
      );
    if (
      token.value === "$json" ||
      token.value === "$nodes" ||
      token.value === "$state"
    )
      return this.make(
        { kind: "root", name: token.value, position: token.position },
        depth,
      );
    if (token.value === "$") {
      this.take("(");
      const name = this.take();
      if (name.kind !== "string")
        throw new ExpressionError(
          "Node reference requires a string literal",
          name.position,
        );
      this.take(")");
      this.take(".");
      this.take("json");
      return this.make(
        { kind: "node", name: name.value, position: token.position },
        depth,
      );
    }
    if (token.value === "$node") {
      this.take("[");
      const name = this.take();
      if (name.kind !== "string")
        throw new ExpressionError(
          "Node reference requires a string literal",
          name.position,
        );
      this.take("]");
      this.take(".");
      this.take("json");
      return this.make(
        { kind: "node", name: name.value, position: token.position },
        depth,
      );
    }
    throw new ExpressionError(
      `Identifier "${token.value}" is not allowed`,
      token.position,
    );
  }
  private members(initial: Ast, depth: number): Ast {
    let result = initial;
    let memberDepth = result.kind === "member" ? result.memberDepth : 0;
    while (this.peek().value === "." || this.peek().value === "[") {
      const opener = this.take();
      let key: string | number;
      let position: number;
      if (opener.value === ".") {
        const token = this.take();
        if (token.kind !== "identifier")
          throw new ExpressionError("Expected property name", token.position);
        key = token.value;
        position = token.position;
      } else {
        let negative = false;
        if (this.peek().value === "-") {
          this.take();
          negative = true;
        }
        const token = this.take();
        if (token.kind !== "string" && token.kind !== "number")
          throw new ExpressionError(
            "Bracket access requires a string or integer literal",
            token.position,
          );
        if (negative && token.kind !== "number")
          throw new ExpressionError(
            "Array index must be an integer",
            token.position,
          );
        if (token.kind === "number" && !/^\d+$/.test(token.value))
          throw new ExpressionError(
            "Array index must be an integer",
            token.position,
          );
        key =
          token.kind === "number"
            ? Number(token.value) * (negative ? -1 : 1)
            : token.value;
        position = token.position;
        this.take("]");
      }
      if (BLOCKED_MEMBERS.has(String(key)))
        throw new ExpressionError(`Property "${key}" is not allowed`, position);
      if (++memberDepth > MAX_MEMBERS)
        throw new ExpressionError(
          "Member-access depth limit exceeded",
          position,
        );
      result = this.make(
        { kind: "member", object: result, key, position, memberDepth },
        depth + memberDepth,
      );
    }
    if (this.peek().value === "(")
      throw new ExpressionError(
        "Function calls are not allowed",
        this.peek().position,
      );
    return result;
  }
}

function lookupNode(name: string, context: ExpressionContext): unknown {
  const all = context.$nodes ?? {};
  const key = resolveNodeKey(name, all, context.nodes);
  return key ? pickJsonSource(all[key]) : undefined;
}

function evaluate(node: Ast, context: ExpressionContext): unknown {
  if (node.kind === "literal") return node.value;
  if (node.kind === "root") return context[node.name];
  if (node.kind === "node") return lookupNode(node.name, context);
  if (node.kind === "member") {
    const object = evaluate(node.object, context);
    if (
      object == null ||
      (typeof object !== "object" && typeof object !== "string")
    )
      return undefined;
    const key = String(node.key);
    if (
      BLOCKED_MEMBERS.has(key) ||
      !Object.prototype.hasOwnProperty.call(object, key)
    )
      return undefined;
    return (object as Record<string, unknown>)[key];
  }
  if (node.kind === "unary") {
    const value = evaluate(node.value, context);
    if (node.operator === "!") return !value;
    if (typeof value !== "number")
      throw new ExpressionError(
        "Unary arithmetic requires a number",
        node.position,
      );
    return -value;
  }
  const left = evaluate(node.left, context);
  if (node.operator === "&&")
    return left ? evaluate(node.right, context) : left;
  if (node.operator === "||")
    return left ? left : evaluate(node.right, context);
  const right = evaluate(node.right, context);
  switch (node.operator) {
    case "==":
    case "===":
      return left === right;
    case "!=":
    case "!==":
      return left !== right;
  }
  if ([">", ">=", "<", "<="].includes(node.operator)) {
    const comparable =
      (typeof left === "number" && typeof right === "number") ||
      (typeof left === "string" && typeof right === "string");
    if (!comparable) {
      throw new ExpressionError(
        `Operator "${node.operator}" requires values of the same comparable type`,
        node.position,
      );
    }
    const comparison = left < right ? -1 : left > right ? 1 : 0;
    if (node.operator === ">") return comparison > 0;
    if (node.operator === ">=") return comparison >= 0;
    if (node.operator === "<") return comparison < 0;
    return comparison <= 0;
  }
  if (typeof left !== "number" || typeof right !== "number")
    throw new ExpressionError(
      `Operator "${node.operator}" requires numbers`,
      node.position,
    );
  const result =
    node.operator === "+"
      ? left + right
      : node.operator === "-"
        ? left - right
        : node.operator === "*"
          ? left * right
          : node.operator === "/"
            ? left / right
            : left % right;
  if (!Number.isFinite(result))
    throw new ExpressionError(
      `Operator "${node.operator}" produced a non-finite number`,
      node.position,
    );
  return result;
}

export function evaluateExpression(
  text: string,
  context: ExpressionContext,
): unknown {
  if (text.length > MAX_INPUT)
    throw new ExpressionError("Input length limit exceeded", MAX_INPUT);
  const wrapped = text.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
  const source = wrapped ? wrapped[1].trim() : text.trim();
  if (!source) throw new ExpressionError("Expression is empty", 0);
  return evaluate(new Parser(tokenize(source)).parse(), context);
}
