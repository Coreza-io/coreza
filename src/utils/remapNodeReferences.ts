import { compileExpression } from "../../coreza-backend/src/nodes/logic/safeExpression";
import { isTypedEditFieldRow } from "../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import { referenceInsertionSpans } from "./editFieldReferenceDrop";
const SELECTOR = /(\$\(\s*|\$node\[\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*[)\]]\s*\.json)/g;

/** Visits supported selectors; undefined preserves the original selector. */
export function mapNodeReferences<T>(value: T, mapName: (name: string) => string | undefined): T {
  if (isTypedEditFieldRow(value)) {
    if (value.valueMode !== "expression" || typeof value.value !== "string") return value;
    const spans = referenceInsertionSpans(value.value).spans;
    const rewriteCode = (match: string, start: string, quoted: string, end: string, offset: number) => {
      if (!spans.some(span => span.kind === "code" && offset >= span.start && offset < span.end)) return match;
      return mapNodeReferences(match, mapName);
    };
    return { ...value, value: value.value.replace(SELECTOR, rewriteCode) } as T;
  }
  if (typeof value === "string") {
    const rewrite = (match: string, start: string, quoted: string, end: string) => {
      if (start.startsWith("$node") !== end.trimStart().startsWith("]")) return match;
      let name: string;
      try {
        name = quoted[0] === '"' ? JSON.parse(quoted) : compileExpression(quoted).evaluate({ $json: {} }) as string;
      } catch { return match; }
      const replacement = mapName(name);
      return replacement !== undefined
        ? `${start}${quoted[0] === '"' ? JSON.stringify(replacement) : "'" + replacement.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"}${end}` : match;
    };
    return value.replace(SELECTOR, rewrite) as T;
  }
  if (Array.isArray(value)) return value.map((item) => mapNodeReferences(item, mapName)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapNodeReferences(item, mapName)])) as T;
  }
  return value;
}

/** Applies a complete mapping simultaneously, only to supported selectors. */
export function remapNodeReferenceMap<T>(value: T, names: Readonly<Record<string, string>>): T {
  return mapNodeReferences(value, (name) => Object.prototype.hasOwnProperty.call(names, name) ? names[name] : undefined);
}

export function remapNodeReferences<T>(value: T, oldId: string, newId: string): T {
  return remapNodeReferenceMap(value, { [oldId]: newId });
}
