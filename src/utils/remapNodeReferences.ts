const CALL_SELECTOR = /(\$\(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*\)\s*\.json)/g;
const BRACKET_SELECTOR = /(\$node\[\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*\]\s*\.json)/g;

/** Applies a complete mapping simultaneously, only to supported selectors. */
export function remapNodeReferenceMap<T>(value: T, names: Readonly<Record<string, string>>): T {
  if (typeof value === "string") {
    const rewrite = (match: string, start: string, quoted: string, end: string) => {
      let name: string;
      try {
        name = quoted[0] === '"' ? JSON.parse(quoted) : quoted.slice(1, -1).replace(/\\(['\\])/g, "$1");
      } catch { return match; }
      return Object.prototype.hasOwnProperty.call(names, name)
        ? `${start}${quoted[0] === '"' ? JSON.stringify(names[name]) : "'" + names[name].replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"}${end}` : match;
    };
    return value.replace(CALL_SELECTOR, rewrite).replace(BRACKET_SELECTOR, rewrite) as T;
  }
  if (Array.isArray(value)) return value.map((item) => remapNodeReferenceMap(item, names)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapNodeReferenceMap(item, names)])) as T;
  }
  return value;
}

export function remapNodeReferences<T>(value: T, oldId: string, newId: string): T {
  return remapNodeReferenceMap(value, { [oldId]: newId });
}
