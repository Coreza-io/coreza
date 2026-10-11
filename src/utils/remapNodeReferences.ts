import { isExpressionContract, compileFieldValue, type FieldDescriptor } from "../../coreza-backend/src/nodes/logic/fieldExpression";
import { compileExpression } from "../../coreza-backend/src/nodes/logic/safeExpression";
import { isTypedEditFieldRow } from "../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import { referenceInsertionSpans } from "./editFieldReferenceDrop";
const SELECTOR = /(\$\(\s*|\$node\[\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*[)\]]\s*\.json)/g;

/** Visits supported selectors; undefined preserves the original selector. */
export function mapNodeReferences<T>(value: T, mapName: (name: string) => string | undefined, expressionContract = false, descriptors?: readonly FieldDescriptor[]): T {
  if (value && typeof value === "object" && isExpressionContract(value as Record<string, unknown>)) expressionContract = true;
  if (expressionContract && descriptors && value && typeof value === 'object' && !Array.isArray(value)) {
    const result = { ...value } as Record<string, unknown>;
    const mapField = (raw: unknown, descriptor: FieldDescriptor): unknown => {
      const compiled = compileFieldValue(raw, descriptor);
      if (compiled.expected === 'structure') return raw;
      if (compiled.template) return mapNodeReferences(raw, mapName, true);
      if (descriptor.type === 'repeater' && Array.isArray(compiled.raw)) {
        const mapped = compiled.raw.map(row => {
          if (!row || typeof row !== 'object') return row;
          const record = row as Record<string, unknown>;
          const mappedRow = { ...record };
          for (const child of descriptor.subFields ?? []) if (child.key in record) {
            if (child.key === 'value' && record.valueMode === 'fixed') continue;
            const typed = child.key === 'value' && record.expression_format_version === 1 && ['string', 'number', 'boolean', 'array', 'object'].includes(String(record.dataType)) ? { ...child, type: String(record.dataType) } : child;
            mappedRow[child.key] = mapField(record[child.key], typed);
          }
          return mappedRow;
        });
        return typeof raw === 'string' ? JSON.stringify(mapped) : mapped;
      }
      if (descriptor.items && Array.isArray(compiled.raw)) return compiled.raw.map(item => mapField(item, descriptor.items!));
      if (descriptor.subFields && raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const mapped = { ...raw as Record<string, unknown> };
        for (const child of descriptor.subFields) if (child.key in mapped) mapped[child.key] = mapField(mapped[child.key], child);
        return mapped;
      }
      return raw;
    };
    for (const descriptor of descriptors) if (descriptor.key in result) result[descriptor.key] = mapField(result[descriptor.key], descriptor);
    return result as T;
  }
  if (isTypedEditFieldRow(value) && value.expression_format_version === 1) {
    return { ...value, fieldName: mapNodeReferences(value.fieldName, mapName, true), dataType: mapNodeReferences(value.dataType, mapName, true), value: typeof value.value === 'string' ? mapNodeReferences(value.value, mapName, true) : value.value } as T;
  }
  if (isTypedEditFieldRow(value)) {
    if (value.valueMode !== "expression" && value.expression_format_version !== 1 || typeof value.value !== "string") return value;
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
    if (expressionContract) {
      const spans = referenceInsertionSpans(value).spans;
      const template = compileFieldValue(value, { key: 'reference', type: 'text' }).template;
      if (!template) return value;
      return value.replace(SELECTOR, (match, start, quoted, end, offset) =>
        template.segments.some(segment => segment.kind === 'code' && offset >= segment.expressionStart && offset < segment.end - 2) && spans.some(span => span.kind === 'code' && offset >= span.start && offset < span.end)
          ? rewrite(match, start, quoted, end) : match) as T;
    }
    return value.replace(SELECTOR, rewrite) as T;
  }
  if (Array.isArray(value)) return value.map((item) => mapNodeReferences(item, mapName, expressionContract)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapNodeReferences(item, mapName, expressionContract)])) as T;
  }
  return value;
}

/** Applies a complete mapping simultaneously, only to supported selectors. */
export function remapNodeReferenceMap<T>(value: T, names: Readonly<Record<string, string>>, descriptors?: readonly FieldDescriptor[]): T {
  return mapNodeReferences(value, (name) => Object.prototype.hasOwnProperty.call(names, name) ? names[name] : undefined, false, descriptors);
}

export function remapNodeReferences<T>(value: T, oldId: string, newId: string): T {
  return remapNodeReferenceMap(value, { [oldId]: newId });
}
