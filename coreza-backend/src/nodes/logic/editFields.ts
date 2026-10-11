import { compileFieldValue, evaluateFieldValue } from "./fieldExpression";
import { coerceFixedValue, checkExpressionResult, editFieldValueType, type EditFieldDataType } from "./fieldValueTypes";
export * from "./fieldValueTypes";
const labels = { string: "String", number: "Number", boolean: "Boolean", array: "Array", object: "Object" };
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
import { pickTypedJsonSource } from "./typedExpressionContext";
import { restoreExpressionTransport } from "./expressionTransport";
import { ExpressionContext, ExpressionError, TYPED_EXPRESSION_FEATURES } from "./safeExpression";
import { compileEditTemplate, evaluateEditTemplate } from "./editTemplate";
import {
  hasTypedEditFieldShape,
  isTypedEditFieldRow,
} from "./typedEditFieldRow";
import { pickJsonSource } from "../../utils/referenceResolution";

export interface EditFieldRowV2 {
  fieldName: string;
  dataType: EditFieldDataType;
  valueMode?: "fixed" | "expression";
  expression_format_version?: 1;
  value: unknown;
}
export interface LegacyFieldRow {
  left?: string;
  operator?: "set" | "copy" | "remove";
  right?: unknown;
}
export type EditFieldRow = EditFieldRowV2 | LegacyFieldRow;

export interface EditFieldsContext extends Partial<ExpressionContext> {
  expressionContexts?: Record<string, unknown>;
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
  abortSignal?: AbortSignal;
}

export type EditFieldErrorPhase =
  | "configuration"
  | "compile"
  | "evaluate"
  | "type"
  | "coerce"
  | "reference"
  | "argument"
  | "resource"
  | "serialization";

export class EditFieldError extends Error {
  readonly code = "EDIT_FIELD_ERROR";
  readonly cause?: unknown;

  constructor(
    message: string,
    public readonly details: {
      nodeId?: string;
      rowIndex: number;
      fieldName: string;
      phase: EditFieldErrorPhase;
      position?: number;
      path?: string;
      argument?: number;
      expected?: string;
      actual?: string;
    },
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "EditFieldError";
    this.cause = options?.cause;
  }
}

const isV2 = (row: EditFieldRow): row is EditFieldRowV2 =>
  isTypedEditFieldRow(row);

const BLOCKED_DESTINATIONS = new Set(["__proto__", "prototype", "constructor"]);

function validateRows(rows: EditFieldRow[], nodeId?: string): void {
  rows.forEach((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new EditFieldError("Edit Fields: invalid row configuration", {
        nodeId,
        rowIndex,
        fieldName: "",
        phase: "configuration",
      });
    }
    const typedShape = hasTypedEditFieldShape(row);
    if (typedShape && !isV2(row)) {
      const candidate = row as Partial<EditFieldRowV2>;
      throw new EditFieldError("Edit Fields: invalid typed row configuration", {
        nodeId,
        rowIndex,
        fieldName:
          typeof candidate.fieldName === "string" ? candidate.fieldName : "",
        phase: "configuration",
      });
    }
    if (!typedShape) {
      const legacy = row as LegacyFieldRow;
      if (
        (legacy.left !== undefined && typeof legacy.left !== "string") ||
        (legacy.operator !== undefined &&
          !["set", "copy", "remove"].includes(legacy.operator)) ||
        (legacy.left && legacy.operator === undefined) ||
        (legacy.operator === "copy" && typeof legacy.right !== "string")
      )
        throw new EditFieldError(
          "Edit Fields: invalid legacy row configuration",
          {
            nodeId,
            rowIndex,
            fieldName: typeof legacy.left === "string" ? legacy.left : "",
            phase: "configuration",
          },
        );
    }
    const fieldName = isV2(row) ? row.fieldName : row.left;
    if (fieldName && BLOCKED_DESTINATIONS.has(fieldName))
      throw new EditFieldError(
        `Edit Fields: destination field "${fieldName}" is not allowed`,
        { nodeId, rowIndex, fieldName, phase: "configuration" },
      );
  });
}

function defineResultValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function applyTypedFieldRow(
  row: EditFieldRowV2,
  rowIndex: number,
  input: unknown,
  context: EditFieldsContext,
  nodeId?: string,
): unknown {
  const expressionContext: ExpressionContext = {
    $json: input,
    $nodes: context.$nodes,
    expressionOutputs: context.expressionOutputs,
    $state: context.$state,
    nodes: context.nodes,
  };
  if (row.expression_format_version === 1) return evaluateFieldValue(compileFieldValue(row.value, { key: "value", type: row.dataType }, `fields[${rowIndex}].value`), { ...expressionContext, $json: pickTypedJsonSource(input) }, nodeId);
  let value: unknown;
  if (row.valueMode === "fixed") {
    try {
      return coerceFixedValue(row.value, row.dataType);
    } catch (error) {
      throw new EditFieldError(
        `Edit Fields: invalid fixed value for field "${row.fieldName}": ${error instanceof Error ? error.message : String(error)}`,
        {
          nodeId,
          rowIndex,
          fieldName: row.fieldName,
          phase: "coerce",
          expected: labels[row.dataType],
          actual: editFieldValueType(row.value),
        },
        { cause: error },
      );
    }
  }
  let compiled: ReturnType<typeof compileEditTemplate>;
  try {
    compiled = compileEditTemplate(String(row.value ?? ""), TYPED_EXPRESSION_FEATURES);
  } catch (error) {
    const position =
      error instanceof ExpressionError ? error.position : undefined;
    throw new EditFieldError(
      `Edit Fields: expression failed for field "${row.fieldName}": ${error instanceof Error ? error.message : String(error)}`,
      {
        nodeId,
        rowIndex,
        fieldName: row.fieldName,
        phase: "compile",
        position,
        expected: labels[row.dataType],
        actual: "Unavailable",
      },
      { cause: error },
    );
  }
  try {
    const transported = compiled.hasComputedSlices ? context.expressionContexts?.[String(rowIndex)] : undefined;
    if (transported !== undefined) Object.assign(expressionContext, restoreExpressionTransport(transported));
    else expressionContext.$json = compiled.hasComputedSlices ? pickTypedJsonSource(input) : pickJsonSource(input);
    value = evaluateEditTemplate(compiled, expressionContext);
  } catch (error) {
    throw new EditFieldError(
      `Edit Fields: expression failed for field "${row.fieldName}": ${error instanceof Error ? error.message : String(error)}`,
      {
        nodeId,
        rowIndex,
        fieldName: row.fieldName,
        phase: error instanceof ExpressionError ? error.phase : "evaluate",
        path: error instanceof ExpressionError ? error.path : undefined,
        argument: error instanceof ExpressionError ? error.argument : undefined,
        position: error instanceof ExpressionError ? error.position : undefined,
        expected: labels[row.dataType],
        actual: "Unavailable",
      },
      { cause: error },
    );
  }
  try {
    return checkExpressionResult(value, row.dataType, row.fieldName);
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
  if (options.abortSignal?.aborted) throw new Error("Workflow cancelled by user");
  validateRows(rows, options.nodeId);
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
  const result: Record<string, unknown> = Object.create(null);
  const legacyResult: Record<string, unknown> = Object.create(null);
  Object.entries(hasV2Rows ? inputRecord : options.legacyResultSeed).forEach(
    ([key, value]) => defineResultValue(result, key, value),
  );
  Object.entries(options.legacyResultSeed).forEach(([key, value]) =>
    defineResultValue(legacyResult, key, value),
  );
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
      defineResultValue(result, row.fieldName, value);
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
      defineResultValue(legacyResult, fieldName, finalValue);
      defineResultValue(result, fieldName, finalValue);
    } else if (
      row.operator === "copy" &&
      typeof value === "string" &&
      legacyResult[value] !== undefined
    ) {
      if (context.persistent && context.setPersistentValue)
        context.setPersistentValue(fieldName, legacyResult[value]);
      defineResultValue(legacyResult, fieldName, legacyResult[value]);
      defineResultValue(result, fieldName, legacyResult[value]);
    } else if (row.operator === "remove") {
      if (context.persistent && context.setPersistentValue)
        context.setPersistentValue(fieldName, undefined);
      delete legacyResult[fieldName];
      delete result[fieldName];
    }
  }
  if (options.abortSignal?.aborted) throw new Error("Workflow cancelled by user");
  return result;
}
