import { ExpressionBudget, ExpressionError, EXPRESSION_LIMITS } from "./safeExpression";

/** Strict expression boundary. Does not invoke getters, toJSON, or host serializers. */
export function encodeExpressionJson(value: unknown, budget: ExpressionBudget, position = 0): string {
  let bytes = 0;
  const parts: string[] = [];
  const ancestors = new Set<object>();
  const emit = (text: string, size = text.length) => {
    bytes += size;
    if (bytes > EXPRESSION_LIMITS.outputBytes)
      throw new ExpressionError("Expression output UTF-8 limit exceeded", position, "resource");
    parts.push(text);
  };
  const fail = (message: string, path: string): never => {
    throw new ExpressionError(message, position, "serialization", path);
  };
  const string = (text: string) => {
    emit('"');
    for (let i = 0; i < text.length; i++) {
      budget.step(position);
      const code = text.charCodeAt(i), char = text[i];
      if (code < 32 || char === '"' || char === "\\") emit(JSON.stringify(char).slice(1, -1));
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        emit(text.slice(i, i + 2), 4); i++;
      } else if (code >= 0xd800 && code <= 0xdfff) emit(`\\u${code.toString(16).padStart(4, "0")}`);
      else emit(char, code < 128 ? 1 : code < 2048 ? 2 : 3);
    }
    emit('"');
  };
  const walk = (current: unknown, path: string, depth: number): void => {
    budget.step(position);
    if (depth > EXPRESSION_LIMITS.depth) fail("Expression output depth limit exceeded", path);
    if (current === null) { emit("null"); return; }
    if (typeof current === "string") { string(current); return; }
    if (typeof current === "boolean") { emit(String(current)); return; }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail("Non-finite output number", path);
      emit(String(current === 0 ? 0 : current)); return;
    }
    if (typeof current !== "object") fail(`Unsupported output ${typeof current}`, path);
    const object = current as object;
    const array = Array.isArray(object);
    if (!array && Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null)
      fail("Unsupported output object", path);
    // Reject an oversized selected array before allocating its property-name list.
    if (array) budget.step(position, (object as unknown[]).length);
    const keys = Object.getOwnPropertyNames(object);
    budget.step(position, keys.length);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (!("value" in descriptor)) fail("Accessor output properties are not supported", `${path}[${JSON.stringify(key)}]`);
      if (!descriptor.enumerable) fail("Non-enumerable output properties are not supported", path);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (object as unknown[]).length))
        fail("Custom array output properties are not supported", `${path}[${JSON.stringify(key)}]`);
    }
    const toJSON = Object.getOwnPropertyDescriptor(object, "toJSON");
    if (typeof toJSON?.value === "function") fail("Custom output serializers are not supported", path);
    if (ancestors.has(object)) fail("Cyclic expression output", path);
    if (Object.getOwnPropertySymbols(object).length) fail("Symbol output properties are not supported", path);
    ancestors.add(object);
    const own = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor) return fail("Sparse output slot", `${path}[${key}]`);
      if (!("value" in descriptor)) return fail("Accessor output properties are not supported", `${path}[${key}]`);
      return descriptor.value;
    };
    if (array) {
      const items = object as unknown[];
      emit("[");
      for (let i = 0; i < items.length; i++) {
        if (i) emit(",");
        walk(own(String(i)), `${path}[${i}]`, depth + 1);
      }
      emit("]");
    } else {
      emit("{");
      let first = true;
      for (const key in object) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
        budget.step(position);
        if (!first) emit(",");
        first = false;
        string(key); emit(":");
        walk(own(key), `${path}[${JSON.stringify(key)}]`, depth + 1);
      }
      emit("}");
    }
    ancestors.delete(object);
  };
  walk(value, "$", 0);
  return parts.join("");
}
