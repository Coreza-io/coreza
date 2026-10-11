export type EditFieldDataType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";
export const EDIT_FIELD_DATA_TYPES: readonly EditFieldDataType[] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
];
export function isEditFieldDataType(
  value: unknown,
): value is EditFieldDataType {
  return (
    typeof value === "string" &&
    EDIT_FIELD_DATA_TYPES.some((type) => type === value)
  );
}
const labels: Record<EditFieldDataType, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  array: "Array",
  object: "Object",
};
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function coerceFixedValue(
  value: unknown,
  type: EditFieldDataType,
): unknown {
  if (type === "string")
    return typeof value === "string" ? value : String(value ?? "");
  if (type === "number") {
    if (typeof value !== "string" && typeof value !== "number")
      throw new Error(`expected Number, but fixed value is ${describe(value)}`);
    if (value === "" || (typeof value === "string" && value.trim() === ""))
      throw new Error("expected Number, but fixed value is empty");
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`expected Number, but fixed value is ${describe(value)}`);
    return number;
  }
  if (type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new Error(`expected Boolean, but fixed value is ${describe(value)}`);
  }
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(
        `expected ${labels[type]}, but fixed value is invalid JSON`,
      );
    }
  }
  if (type === "array" && !Array.isArray(parsed))
    throw new Error(`expected Array, but fixed value is ${describe(parsed)}`);
  if (type === "object" && !isPlainObject(parsed))
    throw new Error(`expected Object, but fixed value is ${describe(parsed)}`);
  return parsed;
}

function describe(value: unknown): string {
  const type =
    value === null
      ? "Null"
      : value === undefined
        ? "Undefined"
        : Array.isArray(value)
          ? "Array"
          : typeof value === "object"
            ? "Object"
            : `${typeof value}`[0].toUpperCase() + `${typeof value}`.slice(1);
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value);
  }
  return `${type} (${rendered})`;
}

export function editFieldValueType(value: unknown): string {
  if (value === null) return "Null";
  if (value === undefined) return "Undefined";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "number" && !Number.isFinite(value))
    return "Non-finite Number";
  return typeof value === "object"
    ? "Object"
    : `${typeof value}`[0].toUpperCase() + `${typeof value}`.slice(1);
}

export function checkExpressionResult(
  value: unknown,
  type: EditFieldDataType,
  fieldName: string,
): unknown {
  let valid = false;
  if (type === "number")
    valid = typeof value === "number" && Number.isFinite(value);
  else if (type === "boolean") valid = typeof value === "boolean";
  else if (type === "array") valid = Array.isArray(value);
  else if (type === "object") valid = isPlainObject(value);
  else if (typeof value === "string") return value;
  else if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (valid) return value;
  throw new Error(
    `Edit Fields: field "${fieldName}" expected ${labels[type]}, but expression returned ${describe(value)}`,
  );
}

