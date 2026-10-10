import { encodeExpressionJson } from "./boundedJson";
import { pickTypedJsonSource } from "./typedExpressionContext";
import {
  pickJsonSource,
  resolveNodeKey,
  resolveNodeIdentity,
} from "../../utils/referenceResolution";
import type { ReferenceNode } from "../../utils/referenceResolution";

export interface ExpressionContext {
  $json: unknown;
  $nodes?: Record<string, unknown>;
  expressionOutputs?: Record<string, unknown>;
  $state?: Record<string, unknown>;
  nodes?: ReferenceNode[];
}

export interface ExpressionFeatures {
  readonly computedSlices?: boolean;
}
export const TYPED_EXPRESSION_FEATURES = Object.freeze({ computedSlices: true });

// Provisional, centrally defined limits. Counters belong to one evaluation, never the cache.
export const EXPRESSION_LIMITS = Object.freeze({ copiedElements: 100_000, workSteps: 1_000_000, outputBytes: 256 * 1024, depth: 32 });
export class ExpressionBudget {
  private copied = 0;
  private work = 0;
  step(position: number, count = 1): void {
    if ((this.work += count) > EXPRESSION_LIMITS.workSteps)
      throw new ExpressionError("Expression work limit exceeded", position, "resource");
  }
  copy(count: number, position: number): void {
    if ((this.copied += count) > EXPRESSION_LIMITS.copiedElements)
      throw new ExpressionError("Expression allocation limit exceeded", position, "resource");
    this.step(position, count);
  }
}

export interface CompiledExpression {
  readonly source: string;
  readonly nodeReferences: readonly string[];
  readonly features: Readonly<ExpressionFeatures>;
  readonly hasComputedSlices: boolean;
  evaluate(context: ExpressionContext, budget?: ExpressionBudget): unknown;
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly phase: "evaluate" | "reference" | "argument" | "resource" | "serialization" = "evaluate",
    public readonly path?: string,
    public readonly argument?: number,
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
  | { kind: "array"; elements: Ast[]; position: number }
  | { kind: "root"; name: "$json" | "$nodes" | "$state"; position: number }
  | { kind: "node"; name: string; position: number }
  | { kind: "identifier"; name: string; position: number }
  | {
      kind: "member";
      object: Ast;
      key: string | number;
      position: number;
      memberDepth: number;
    }
  | {
      kind: "slice";
      object: Ast;
      start?: Ast;
      end?: Ast;
      computed: boolean;
      position: number;
      memberDepth: number;
    }
  | {
      kind: "projection";
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

const MAX_INPUT = 8192;
const MAX_DEPTH = 32;
const MAX_NODES = 1024;
const MAX_ARRAY_ELEMENTS = 256;
const MAX_MEMBERS = 32;
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
            b: "\b",
            f: "\f",
            "/": "/",
            "\\": "\\",
            "'": "'",
            '"': '"',
          };
          if (source[i] === "u") {
            const hex = source.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex))
              throw new ExpressionError("Invalid Unicode escape", i - 1);
            value += String.fromCharCode(parseInt(hex, 16));
            i += 5;
          } else {
            if (!(source[i] in escaped))
              throw new ExpressionError("Unsupported string escape", i - 1);
            value += escaped[source[i++]];
          }
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
    if (source.startsWith("{{", i) || source.startsWith("}}", i)) {
      tokens.push({ kind: "punctuation", value: source.slice(i, i + 2), position: i }); i += 2;
      continue;
    }
    if (".[]():,".includes(c)) {
      tokens.push({ kind: "punctuation", value: c, position: i++ });
      continue;
    }
    throw new ExpressionError(`Unexpected token "${c}"`, i);
  }
  tokens.push({ kind: "eof", value: "", position: source.length });
  return tokens;
}

function literalSliceBound(node: Ast): number | undefined {
  if (node.kind === "literal" && typeof node.value === "number") return node.value;
  if (node.kind === "unary" && node.operator === "-" && node.value.kind === "literal" && typeof node.value.value === "number") return -node.value.value;
  return undefined;
}

class Parser {
  private index = 0;
  private nodes = 0;
  private boundDepth = 0;
  constructor(private readonly tokens: Token[], private readonly features: ExpressionFeatures) {}
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
    } else if (token.value === "{{" && this.features.computedSlices && this.boundDepth > 0) {
      this.take();
      result = this.expression(0, depth + 1);
      this.take("}}");
    } else if (token.value === "(") {
      this.take();
      result = this.expression(0, depth + 1);
      this.take(")");
    } else if (token.value === "[") {
      result = this.arrayLiteral(depth);
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
  private arrayLiteral(depth: number): Ast {
    const opener = this.take("[");
    const elements: Ast[] = [];
    if (this.peek().value === "]") {
      this.take();
      return this.make(
        { kind: "array", elements, position: opener.position },
        depth,
      );
    }
    while (true) {
      const elementPosition = this.peek().position;
      if (elements.length >= MAX_ARRAY_ELEMENTS)
        throw new ExpressionError(
          "Array literal element limit exceeded",
          elementPosition,
        );
      elements.push(this.expression(0, depth + 1));
      const separator = this.peek();
      if (separator.value === "]") {
        this.take();
        break;
      }
      if (separator.value === ":")
        throw new ExpressionError(
          "Array slices are only valid on an existing array value",
          separator.position,
        );
      if (separator.value !== ",")
        throw new ExpressionError('Expected "," or "]"', separator.position);
      this.take();
      if (this.peek().value === "]")
        throw new ExpressionError('Unexpected token ","', separator.position);
    }
    return this.make(
      { kind: "array", elements, position: opener.position },
      depth,
    );
  }
  private rootOrLiteral(depth: number): Ast {
    const token = this.take();
    if (
      token.value === "true" ||
      token.value === "false" ||
      token.value === "null" ||
      token.value === "undefined"
    )
      return this.make(
        {
          kind: "literal",
          value:
            token.value === "null"
              ? null
              : token.value === "undefined"
                ? undefined
                : token.value === "true",
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
    if (token.value === "lastN" && this.peek().value === "(")
      throw new ExpressionError("lastN has been removed; use array[-count:] (zero selects the whole array)", token.position);
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
    return this.make(
      { kind: "identifier", name: token.value, position: token.position },
      depth,
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
        const slicePosition = opener.position;
        const boundTokenStart = this.index;
        const readBound = (): Ast | undefined => {
          if ([":", "]"].includes(this.peek().value)) return undefined;
          this.boundDepth++;
          try { return this.expression(0, depth + memberDepth + 1); }
          finally { this.boundDepth--; }
        };
        const first = readBound();
        if (this.peek().value === ":") {
          this.take();
          const end = readBound();
          this.take("]");
          const computed = this.tokens.slice(boundTokenStart, this.index).some(token => token.value === "{{")
            || [first, end].some(bound => bound !== undefined && literalSliceBound(bound) === undefined);
          if (computed && !this.features.computedSlices)
            throw new ExpressionError("Computed slice bounds require a typed Edit Fields expression", slicePosition);
          for (const bound of [first, end]) {
            const number = bound && literalSliceBound(bound);
            if (number !== undefined && !Number.isInteger(number))
              throw new ExpressionError("Array index must be an integer", bound!.position);
          }
          if (++memberDepth > MAX_MEMBERS)
            throw new ExpressionError("Member-access depth limit exceeded", slicePosition);
          result = this.make({ kind: "slice", object: result, start: first, end, computed, position: slicePosition, memberDepth }, depth + memberDepth - 1);
          continue;
        }
        const number = first && literalSliceBound(first);
        if (this.tokens.slice(boundTokenStart, this.index).some(token => token.value === "{{"))
          throw new ExpressionError("Nested expressions are only supported in slice bounds", slicePosition);
        if (first?.kind === "literal" && typeof first.value === "string") key = first.value;
        else if (number !== undefined && Number.isInteger(number)) key = number;
        else throw new ExpressionError("Bracket access requires a string or integer literal", first?.position ?? slicePosition);
        position = first!.position;
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
        {
          kind:
            (result.kind === "slice" && !result.computed) || result.kind === "projection"
              ? "projection"
              : "member",
          object: result,
          key,
          position,
          memberDepth,
        },
        depth + memberDepth - 1,
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

function evaluate(node: Ast, context: ExpressionContext, budget?: ExpressionBudget, strict = false): unknown {
  budget?.step(node.position);
  if (node.kind === "literal") return node.value;
  if (node.kind === "array") {
    budget?.copy(node.elements.length, node.position);
    return node.elements.map((element) => evaluate(element, context, budget, strict));
  }
  if (node.kind === "identifier") {
    const input = context.$json;
    if (
      input === null ||
      typeof input !== "object" ||
      BLOCKED_MEMBERS.has(node.name)
    )
      return undefined;
    return readMember(input, node.name, strict, node.position);
  }
  if (node.kind === "root") return strict && node.name === "$nodes" ? context.expressionOutputs ?? context.$nodes : context[node.name];
  if (node.kind === "node") {
    if (!strict) return lookupNode(node.name, context);
    let identity;
    try { identity = resolveNodeIdentity(node.name, context.nodes ?? []); }
    catch (error) { throw new ExpressionError(error instanceof Error ? error.message : String(error), node.position, "reference"); }
    if (!identity) throw new ExpressionError(`Missing node identity "${node.name}"`, node.position, "reference");
    const outputs = context.expressionOutputs ?? context.$nodes ?? {};
    if (!Object.prototype.hasOwnProperty.call(outputs, identity.id) || readOwnData(outputs, identity.id, node.position) === undefined)
      throw new ExpressionError(`Output unavailable for node "${identity.id}"`, node.position, "reference");
    try { return pickTypedJsonSource(readOwnData(outputs, identity.id, node.position)); }
    catch (error) { if (error instanceof ExpressionError) throw error; throw new ExpressionError(error instanceof Error ? error.message : String(error), node.position, "serialization"); }
  }
  if (node.kind === "slice") {
    const operand = (ast: Ast, argument: number): unknown => {
      try { return evaluate(ast, context, budget, strict || node.computed); }
      catch (error) {
        if (error instanceof ExpressionError && error.argument === undefined)
          throw new ExpressionError(error.message.replace(/ at position \d+$/, ""), error.position, error.phase, error.path, argument);
        throw error;
      }
    };
    const value = operand(node.object, 1);
    const readBound = (ast: Ast | undefined, argument: number): number | undefined => {
      if (!ast) return undefined;
      const bound = operand(ast, argument);
      if (typeof bound !== "number" || ((node.computed || strict) && !Number.isSafeInteger(bound)))
        throw new ExpressionError("Slice bound must be a finite safe integer number", ast.position, "argument", undefined, argument);
      return bound;
    };
    const first = readBound(node.start, 2), last = readBound(node.end, 3);
    if (!Array.isArray(value)) {
      if (node.computed) throw new ExpressionError("Slice source must be an array", node.object.position, "argument", undefined, 1);
      return undefined;
    }
    if (!budget) return value.slice(first, last);
    const bound = (n: number | undefined, fallback: number) => n === undefined ? fallback : n < 0 ? Math.max(value.length + n, 0) : Math.min(n, value.length);
    const start = bound(first, 0), end = bound(last, value.length);
    const selected = copyArray(value, start, Math.max(end - start, 0), node.position, budget);
    if (node.computed) encodeExpressionJson(selected, budget, node.position);
    return selected;
  }
  if (node.kind === "member" || node.kind === "projection") {
    const object = evaluate(node.object, context, budget, strict);
    if (strict && node.kind === "member" && node.object.kind === "root" && node.object.name === "$nodes") {
      let identity;
      try { identity = resolveNodeIdentity(String(node.key), context.nodes ?? []); }
      catch (error) { throw new ExpressionError(error instanceof Error ? error.message : String(error), node.position, "reference"); }
      if (!identity) throw new ExpressionError(`Missing node identity "${node.key}"`, node.position, "reference");
      const result = readMember(object, identity.id, true, node.position);
      if (result === undefined) throw new ExpressionError(`Output unavailable for node "${identity.id}"`, node.position, "reference");
      return result;
    }
    if (
      object == null ||
      (typeof object !== "object" && typeof object !== "string")
    )
      return undefined;
    if (node.kind === "projection") {
      if (!Array.isArray(object)) return undefined;
      budget?.copy(object.length, node.position);
      if (!budget) return object.map((item) => readMember(item, node.key, strict, node.position));
      const projected = new Array(object.length);
      for (let i = 0; i < object.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(object, String(i)))
          throw new ExpressionError("Sparse array slots are not supported", node.position, "serialization", `[${i}]`);
        projected[i] = readMember(readOwnData(object, String(i), node.position), node.key, true, node.position);
      }
      return projected;
    }
    return readMember(object, node.key, strict, node.position);
  }
  if (node.kind === "unary") {
    const value = evaluate(node.value, context, budget, strict);
    if (node.operator === "!") return !value;
    if (typeof value !== "number")
      throw new ExpressionError(
        "Unary arithmetic requires a number",
        node.position,
      );
    return -value;
  }
  const left = evaluate(node.left, context, budget, strict);
  if (node.operator === "&&")
    return left ? evaluate(node.right, context, budget, strict) : left;
  if (node.operator === "||")
    return left ? left : evaluate(node.right, context, budget, strict);
  const right = evaluate(node.right, context, budget, strict);
  switch (node.operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
    case "!=": {
      if (
        (left !== null && typeof left === "object") ||
        (right !== null && typeof right === "object")
      )
        throw new ExpressionError(
          `Operator "${node.operator}" does not accept objects`,
          node.position,
        );
      // Deliberately implements JavaScript primitive loose equality (no object coercion).
      const equal = left == right;
      return node.operator === "==" ? equal : !equal;
    }
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
  if (
    node.operator === "+" &&
    typeof left === "string" &&
    typeof right === "string"
  )
    {
      if (budget && left.length + right.length > EXPRESSION_LIMITS.outputBytes)
        throw new ExpressionError("Expression string limit exceeded", node.position, "resource");
      return left + right;
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

function readMember(object: unknown, key: string | number, strict = false, position = 0): unknown {
  if (
    object == null ||
    (typeof object !== "object" && typeof object !== "string")
  )
    return undefined;
  const actualKey =
    Array.isArray(object) && typeof key === "number" && key < 0
      ? object.length + key
      : key;
  const property = String(actualKey);
  return BLOCKED_MEMBERS.has(property) ||
    !Object.prototype.hasOwnProperty.call(object, property)
    ? undefined
    : strict ? readOwnData(object, property, position) : (object as Record<string, unknown>)[property];
}

function readOwnData(object: object | string, key: string, position: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new ExpressionError("Accessor properties are not supported", position, "serialization", key);
  return descriptor.value;
}

function copyArray(source: unknown[], start: number, size: number, position: number, budget?: ExpressionBudget): unknown[] {
  budget?.copy(size, position);
  const result = new Array(size);
  for (let i = 0; i < size; i++) {
    const key = String(start + i);
    if (!Object.prototype.hasOwnProperty.call(source, key))
      throw new ExpressionError("Sparse array slots are not supported", position, "serialization", `[${key}]`);
    result[i] = readOwnData(source, key, position);
  }
  return result;
}

export function evaluateExpression(
  text: string,
  context: ExpressionContext,
): unknown {
  return compileExpression(text).evaluate(context);
}

export function compileExpression(text: string, options: ExpressionFeatures = {}): CompiledExpression {
  if (text.length > MAX_INPUT)
    throw new ExpressionError("Input length limit exceeded", MAX_INPUT);
  const source = text.trim();
  if (!source) throw new ExpressionError("Expression is empty", 0);
  const features = Object.freeze({ computedSlices: options.computedSlices === true });
  const ast = new Parser(tokenize(source), features).parse();
  let hasComputedSlices = false;
  const nodeReferences = new Set<string>();
  const visit = (node: Ast): void => {
    if (node.kind === "node") nodeReferences.add(node.name);
    if (node.kind === "member" && node.object.kind === "root" && node.object.name === "$nodes") nodeReferences.add(String(node.key));
    if (node.kind === "slice") {
      hasComputedSlices ||= node.computed; visit(node.object);
      if (node.start) visit(node.start); if (node.end) visit(node.end);
    }
    else if (node.kind === "array") node.elements.forEach(visit);
    else if (
      node.kind === "member" ||
      node.kind === "projection"
    )
      visit(node.object);
    else if (node.kind === "unary") visit(node.value);
    else if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(ast);
  return Object.freeze({
    source,
    nodeReferences: Object.freeze([...nodeReferences]),
    features,
    hasComputedSlices,
    evaluate: (context: ExpressionContext, budget?: ExpressionBudget) => evaluate(ast, context, budget ?? (hasComputedSlices ? new ExpressionBudget() : undefined)),
  });
}
