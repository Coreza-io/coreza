export interface TypedEditFieldRow {
  fieldName: string;
  dataType: string;
  valueMode: "fixed" | "expression";
  value: unknown;
}

export function isTypedEditFieldRow(
  value: unknown,
): value is TypedEditFieldRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<TypedEditFieldRow>;
  return (
    typeof row.fieldName === "string" &&
    ["string", "number", "boolean", "array", "object"].includes(
      row.dataType ?? "",
    ) &&
    (row.valueMode === "fixed" || row.valueMode === "expression") &&
    "value" in row
  );
}
