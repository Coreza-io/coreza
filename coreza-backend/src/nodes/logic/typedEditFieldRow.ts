export interface TypedEditFieldRow {
  fieldName: string;
  dataType: string;
  valueMode?: "fixed" | "expression";
  expression_format_version?: 1;
  value: unknown;
}

export function hasTypedEditFieldShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["fieldName", "dataType", "valueMode", "value"].some(
    (key) => key in value,
  );
}

export function isTypedEditFieldRow(
  value: unknown,
): value is TypedEditFieldRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<TypedEditFieldRow>;
  return (
    typeof row.fieldName === "string" &&
    (row.expression_format_version === 1 ? typeof row.dataType === "string" : ["string", "number", "boolean", "array", "object"].includes(row.dataType ?? "")) &&
    (row.valueMode === "fixed" || row.valueMode === "expression" || row.expression_format_version === 1) &&
    "value" in row
  );
}
