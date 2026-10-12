import { compileExpression, ExpressionError, ExpressionBudget } from "./safeExpression";
import { encodeExpressionJson } from "./boundedJson";
import type { ExpressionFeatures, CompiledExpression, ExpressionContext } from "./safeExpression";

const MAX_SOURCE = 8192;
const MAX_SEGMENTS = 64;
const MAX_RENDERED = 256 * 1024;

export type EditTemplateSegment =
  | { kind: "text"; value: string; start: number; end: number }
  | {
      kind: "code";
      value: string;
      start: number;
      end: number;
      expressionStart: number;
      expression: CompiledExpression;
    };

export interface CompiledEditTemplate {
  readonly hasComputedSlices: boolean;
  readonly hasVariables: boolean;
  readonly source: string;
  readonly segments: readonly EditTemplateSegment[];
  readonly nodeReferences: readonly string[];
}

const cache = new Map<string, CompiledEditTemplate>();

export function compileEditTemplate(source: string, features: ExpressionFeatures = {}): CompiledEditTemplate {
  const cacheKey = `${features.computedSlices === true ? "typed-slices:" : "base:"}${source}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (source.length > MAX_SOURCE)
    throw new ExpressionError("Template source limit exceeded", MAX_SOURCE);
  const segments: EditTemplateSegment[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("{{", cursor);
    if (open < 0) {
      if (cursor < source.length)
        segments.push({
          kind: "text",
          value: source.slice(cursor),
          start: cursor,
          end: source.length,
        });
      break;
    }
    if (open > cursor)
      segments.push({
        kind: "text",
        value: source.slice(cursor, open),
        start: cursor,
        end: open,
      });
    let i = open + 2;
    let quote: "'" | '"' | null = null;
    let escaped = false;
    let brackets = 0;
    let nestedTemplates = 0;
    for (; i < source.length; i++) {
      const char = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === "(" || char === "[") {
        brackets++;
        if (brackets > 32)
          throw new ExpressionError("Template nesting limit exceeded", i);
        continue;
      }
      if (char === ")" || char === "]") {
        brackets--;
        if (brackets < 0)
          throw new ExpressionError("Unexpected closing bracket", i);
        continue;
      }
      if (char === "{" && source[i + 1] === "{") {
        if (!features.computedSlices || brackets === 0)
          throw new ExpressionError("Nested template delimiter", i);
        if (++nestedTemplates > 32) throw new ExpressionError("Template nesting limit exceeded", i);
        i++; continue;
      }
      if (char === "}" && source[i + 1] === "}") {
        if (nestedTemplates > 0) { nestedTemplates--; i++; continue; }
        if (brackets === 0) break;
      }
    }
    if (i >= source.length)
      throw new ExpressionError("Unclosed template delimiter", open);
    const rawCode = source.slice(open + 2, i);
    const expressionStart =
      open + 2 + rawCode.length - rawCode.trimStart().length;
    let expression: CompiledExpression;
    try {
      expression = compileExpression(rawCode.trim(), features);
    } catch (error) {
      if (error instanceof ExpressionError)
        throw new ExpressionError(
          error.message.replace(/ at position \d+$/, ""),
          expressionStart + error.position,
          error.phase, error.path, error.argument,
        );
      throw error;
    }
    segments.push({
      kind: "code",
      value: rawCode.trim(),
      start: open,
      end: i + 2,
      expressionStart,
      expression,
    });
    cursor = i + 2;
    if (segments.length > MAX_SEGMENTS)
      throw new ExpressionError("Template segment limit exceeded", cursor);
  }
  if (segments.length === 0)
    segments.push({
      kind: "text",
      value: source,
      start: 0,
      end: source.length,
    });
  const nodeReferences = new Set<string>();
  for (const segment of segments)
    if (segment.kind === "code")
      for (const name of segment.expression.nodeReferences)
        nodeReferences.add(name);
  const compiled = Object.freeze({
    source,
    hasComputedSlices: segments.some(segment => segment.kind === "code" && segment.expression.hasComputedSlices),
    hasVariables: segments.some(segment => segment.kind === "code" && segment.expression.hasVariables),
    segments: Object.freeze(segments),
    nodeReferences: Object.freeze([...nodeReferences]),
  });
  if (cache.size >= 500) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(cacheKey, compiled);
  return compiled;
}

function render(value: unknown, position: number): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    throw new ExpressionError("Template value cannot be serialized", position);
  }
}

function evaluateSegment(
  segment: Extract<EditTemplateSegment, { kind: "code" }>,
  context: ExpressionContext,
  budget?: ExpressionBudget,
): unknown {
  try {
    return segment.expression.evaluate(context, budget);
  } catch (error) {
    if (error instanceof ExpressionError) {
      throw new ExpressionError(
        error.message.replace(/ at position \d+$/, ""),
        segment.expressionStart + error.position,
        error.phase, error.path, error.argument,
      );
    }
    throw error;
  }
}

export function evaluateEditTemplate(
  compiled: CompiledEditTemplate,
  context: ExpressionContext,
): unknown {
  const budget = compiled.hasComputedSlices || compiled.hasVariables ? new ExpressionBudget() : undefined;
  if (compiled.segments.length === 1 && compiled.segments[0].kind === "code") {
    const value = evaluateSegment(compiled.segments[0], context, budget);
    if (budget) encodeExpressionJson(value, budget, compiled.segments[0].expressionStart);
    return value;
  }
  let result = "";
  for (const segment of compiled.segments) {
    let rendered: string;
    if (segment.kind === "text") rendered = segment.value;
    else {
      const value = evaluateSegment(segment, context, budget);
      if (budget) {
        const json = encodeExpressionJson(value, budget, segment.expressionStart);
        rendered = value === null ? "" : typeof value === "string" ? value : json;
      } else rendered = render(value, segment.start + 2);
    }
    if (budget) encodeExpressionJson(result + rendered, budget, segment.end);
    result += rendered;
    if (result.length > MAX_RENDERED)
      throw new ExpressionError("Rendered output limit exceeded", segment.end);
  }
  return result;
}
