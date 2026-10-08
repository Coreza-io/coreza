const CALL_SELECTOR = /(\$\(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*\)\s*\.json)/g;
const BRACKET_SELECTOR = /(\$node\[\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*\]\s*\.json)/g;

/** Visits supported selectors; undefined preserves the original selector. */
export function mapNodeReferences<T>(value: T, mapName: (name: string) => string | undefined): T {
  if (typeof value === "string") {
    const rewrite = (match: string, start: string, quoted: string, end: string) => {
      let name: string;
      try {
        name = quoted[0] === '"' ? JSON.parse(quoted) : quoted.slice(1, -1).replace(/\\(['\\])/g, "$1");
      } catch { return match; }
      const replacement = mapName(name);
      return replacement !== undefined
        ? `${start}${quoted[0] === '"' ? JSON.stringify(replacement) : "'" + replacement.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"}${end}` : match;
    };
    return value.replace(CALL_SELECTOR, rewrite).replace(BRACKET_SELECTOR, rewrite) as T;
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
