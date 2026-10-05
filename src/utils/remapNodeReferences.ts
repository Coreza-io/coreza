const CALL_SELECTOR = /(\$\(\s*)(['"])([^'"]+)(\2)(\s*\)\s*\.json)/g;
const BRACKET_SELECTOR = /(\$node\[\s*)(['"])([^'"]+)(\2)(\s*\]\s*\.json)/g;

function remapString(value: string, oldId: string, newId: string): string {
  return value
    .replace(CALL_SELECTOR, (match, start, quote, name, endQuote, end) =>
      name === oldId ? `${start}${quote}${newId}${endQuote}${end}` : match)
    .replace(BRACKET_SELECTOR, (match, start, quote, name, endQuote, end) =>
      name === oldId ? `${start}${quote}${newId}${endQuote}${end}` : match);
}

/** Remaps only supported node selectors inside persisted editable values. */
export function remapNodeReferences<T>(value: T, oldId: string, newId: string): T {
  if (typeof value === "string") return remapString(value, oldId, newId) as T;
  if (Array.isArray(value)) return value.map((item) => remapNodeReferences(item, oldId, newId)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapNodeReferences(item, oldId, newId)])) as T;
  }
  return value;
}
