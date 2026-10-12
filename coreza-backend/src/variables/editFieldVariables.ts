import { applyFieldRows, type ApplyFieldRowsOptions, type EditFieldRow } from "../nodes/logic/editFields";
import { isTypedEditFieldRow } from "../nodes/logic/typedEditFieldRow";
import { VARIABLE_LIMITS, validateVariable, type VariableChange } from "./contract";

export function isPersistentVariableEdit(node: any): boolean {
  return (node.name === "Edit Fields" || node.type === "Edit Fields" || node.data?.definition?.name === "Edit Fields")
    && node.values?.persistent === true && Array.isArray(node.values.fields)
    && node.values.fields.some(isTypedEditFieldRow);
}

// Stage all rows before invoking any storage callback. No partial or preview writes.
export function stagePersistentFields(rows: EditFieldRow[], options: ApplyFieldRowsOptions) {
  if (rows.length > VARIABLE_LIMITS.count) throw new Error("Persistent Edit Fields supports at most 128 variables");
  const names = new Set<string>();
  for (const row of rows) {
    if (!isTypedEditFieldRow(row)) throw new Error("Persistent variables require typed Edit Fields rows; migrate legacy rows explicitly");
    if (!row.fieldName) throw new Error("Persistent Edit Fields requires a variable name");
    validateVariable(row.fieldName, null);
    if (names.has(row.fieldName)) throw new Error(`Duplicate persistent variable name: ${row.fieldName}`);
    if (row.dataType === "array" || row.dataType === "object") throw new Error("Persistent variables support String, Number and Boolean; turn Persistent off for Array/Object fields");
    names.add(row.fieldName);
  }
  const result = applyFieldRows(rows, { ...options, context: { ...options.context, persistent: false } });
  const changes: VariableChange[] = [];
  for (const key of names) {
    const value = result[key];
    validateVariable(key, value);
    changes.push({ key, value });
  }
  return { result, changes };
}
