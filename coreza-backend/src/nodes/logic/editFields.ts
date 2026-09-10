import { ExpressionContext, ExpressionError } from "./safeExpression";
import { compileEditTemplate, evaluateEditTemplate } from "./editTemplate";
import { isTypedEditFieldRow } from "./typedEditFieldRow";
import { pickJsonSource } from "../../utils/referenceResolution";

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
export interface EditFieldRowV2 {
  fieldName: string;
  dataType: EditFieldDataType;
  valueMode: "fixed" | "expression";
  value: unknown;
}
export interface LegacyFieldRow {
  left?: string;
  operator?: "set" | "copy" | "remove";
  right?: unknown;
}
export type EditFieldRow = EditFieldRowV2 | LegacyFieldRow;

export interface EditFieldsContext extends Partial<ExpressionContext> {
  persistent?: boolean;
  getPersistentValue?: (key: string) => unknown;
  setPersistentValue?: (key: string, value: unknown) => unknown;
}

export interface ApplyFieldRowsOptions {
  input: unknown;
  legacyResultSeed: Record<string, unknown>;
  context?: EditFieldsContext;
  /** Preserve the executor's historical read-before-write persistent Set behavior. */
  legacyPersistentRead?: boolean;
  nodeId?: string;
}

export type EditFieldErrorPhase =
  | "configuration"
  | "compile"
  | "evaluate"
  | "type"
  | "coerce";

export class EditFieldError extends Error {
  readonly code = "EDIT_FIELD_ERROR";

  constructor(
    message: string,
    public readonly details: {
      nodeId?: string;
      rowIndex: number;
      fieldName: string;
      phase: EditFieldErrorPhase;
      position?: number;
      expected?: string;
      actual?: string;
    },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EditFieldError";
  }
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

const isV2 = (row: EditFieldRow): row is EditFieldRowV2 =>
  isTypedEditFieldRow(row);

export function applyTypedFieldRow(
  row: EditFieldRowV2,
  rowIndex: number,
  input: unknown,
  context: EditFieldsContext,
  nodeId?: string,
): unknown {
  const expressionContext: ExpressionContext = {
    $json: pickJsonSource(input),
    $nodes: context.$nodes,
    $state: context.$state,
    nodes: context.nodes,
  };
  let value: unknown;
  try {
    value =
      row.valueMode === "expression"
        ? evaluateEditTemplate(
            compileEditTemplate(String(row.value ?? "")),
            expressionContext,
          )
        : coerceFixedValue(row.value, row.dataType);
  } catch (error) {
    if (error instanceof EditFieldError) throw error;
    const position =
      error instanceof ExpressionError ? error.position : undefined;
    const phase: EditFieldErrorPhase =
      row.valueMode === "fixed"
        ? "coerce"
        : error instanceof ExpressionError &&
            /Template|delimiter/.test(error.message)
          ? "compile"
          : "evaluate";
    throw new EditFieldError(
      `Edit Fields: ${row.valueMode === "expression" ? "expression failed for" : "invalid fixed value for"} field "${row.fieldName}": ${error instanceof Error ? error.message : String(error)}`,
      {
        nodeId,
        rowIndex,
        fieldName: row.fieldName,
        phase,
        position,
        expected: labels[row.dataType],
      },
      { cause: error },
    );
  }
  try {
    return row.valueMode === "expression"
      ? checkExpressionResult(value, row.dataType, row.fieldName)
      : value;
  } catch (error) {
    throw new EditFieldError(
      error instanceof Error ? error.message : String(error),
      {
        nodeId,
        rowIndex,
        fieldName: row.fieldName,
        phase: "type",
        expected: labels[row.dataType],
        actual: editFieldValueType(value),
      },
      { cause: error },
    );
  }
}

export function applyFieldRows(
  rows: EditFieldRow[],
  options: ApplyFieldRowsOptions,
): Record<string, unknown> {
  const hasV2Rows = rows.some(isV2);
  if (hasV2Rows && options.context?.persistent)
    throw new EditFieldError(
      "Edit Fields: typed rows do not support persistence",
      {
        nodeId: options.nodeId,
        rowIndex: rows.findIndex(isV2),
        fieldName: "",
        phase: "configuration",
      },
    );
  const inputRecord = isPlainObject(options.input) ? options.input : {};
  const result = hasV2Rows
    ? { ...inputRecord }
    : { ...options.legacyResultSeed };
  const legacyResult = { ...options.legacyResultSeed };
  const context = options.context ?? {};
  for (const [rowIndex, row] of rows.entries()) {
    if (isV2(row)) {
      if (!row.fieldName) continue;
      const value = applyTypedFieldRow(
        row,
        rowIndex,
        options.input,
        context,
        options.nodeId,
      );
      result[row.fieldName] = value;
      continue;
    }
    const fieldName = row.left;
    const value = row.right;
    if (!fieldName) continue;
    if (row.operator === "set") {
      let finalValue = value;
      if (
        context.persistent &&
        context.getPersistentValue &&
        context.setPersistentValue &&
        options.legacyPersistentRead
      ) {
        const current = context.getPersistentValue(fieldName);
        finalValue = current !== undefined ? current : value;
        if (current !== finalValue)
          context.setPersistentValue(fieldName, finalValue);
      } else if (context.persistent && context.setPersistentValue)
        context.setPersistentValue(fieldName, value);
      legacyResult[fieldName] = finalValue;
      result[fieldName] = finalValue;
    } else if (
      row.operator === "copy" &&
      typeof value === "string" &&
      legacyResult[value] !== undefined
    ) {
      if (context.persistent && context.setPersistentValue)
        context.setPersistentValue(fieldName, legacyResult[value]);
      legacyResult[fieldName] = legacyResult[value];
      result[fieldName] = legacyResult[value];
    } else if (row.operator === "remove") {
      if (context.persistent && context.setPersistentValue)
        context.setPersistentValue(fieldName, undefined);
      delete legacyResult[fieldName];
      delete result[fieldName];
    }
  }
  return result;
}
