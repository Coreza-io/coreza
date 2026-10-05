const NODE_SELECTOR = /(\$\(\s*)(['"])([^'"]+)(\2)(\s*\)\s*\.json)|(\$node\[\s*)(['"])([^'"]+)(\7)(\s*\]\s*\.json)/g;

function remapString(value: string, oldId: string, newId: string): string {
  return value.replace(
    NODE_SELECTOR,
    (match, callStart, callQuote, callName, callEndQuote, callEnd, bracketStart, bracketQuote, bracketName, bracketEndQuote, bracketEnd) => {
      if (callName === oldId) return `${callStart}${callQuote}${newId}${callEndQuote}${callEnd}`;
      if (bracketName === oldId) return `${bracketStart}${bracketQuote}${newId}${bracketEndQuote}${bracketEnd}`;
      return match;
    },
  );
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
