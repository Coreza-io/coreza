// Editor metadata travels with saved values, but never becomes an action parameter.
export const FIELD_VALUE_MODES_KEY = "__fieldValueModes";
export type FieldValueMode = "fixed" | "expression";

export function getFieldValueMode(values: Record<string, any>, key: string): FieldValueMode {
  const saved = values[FIELD_VALUE_MODES_KEY]?.[key];
  if (saved === "fixed" || saved === "expression") return saved;
  // Existing workflows continue to evaluate templates until explicitly set to Fixed.
  return typeof values[key] === "string" && values[key].includes("{{")
    ? "expression"
    : "fixed";
}

export function isFixedField(values: Record<string, any>, key: string): boolean {
  return values[FIELD_VALUE_MODES_KEY]?.[key] === "fixed";
}

export function parameterEntries(values: Record<string, any>): [string, any][] {
  return Object.entries(values).filter(([key]) => key !== FIELD_VALUE_MODES_KEY && key !== "__continueOnError" && key !== "__normalBrokerValues");
}
