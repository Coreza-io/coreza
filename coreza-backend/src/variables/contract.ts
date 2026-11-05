import { isTypedEditFieldRow } from "../nodes/logic/typedEditFieldRow";
import { compileEditTemplate } from "../nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../nodes/logic/safeExpression";
export type VariableValue = string | number | boolean | null;
export const VARIABLE_LIMITS = Object.freeze({ count: 128, keyBytes: 64, valueBytes: 4096, snapshotBytes: 65536 });
export interface VariableEntry { key: string; value: VariableValue; value_type: string; updated_at: string }
export interface VariableSnapshot {
  schemaVersion: 1;
  owner: string;
  workflowId?: string;
  revision: string;
  loadedAt: number;
  values: Readonly<Record<string, VariableValue>>;
  entries: readonly VariableEntry[];
  checkpoint?: Readonly<{ epoch: string; writerFence: string; sqlCheckpointGeneration: string; source: "sql-checkpoint" }>;
}
export function validateVariable(key: unknown, value: unknown): asserts value is VariableValue {
  if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key))
    throw new Error("Invalid variable name (maximum 64 characters)");
  if (value !== null && typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value)))
    throw new Error("Variables support only strings, finite numbers, booleans and null");
  if (new TextEncoder().encode(JSON.stringify(value)).length > VARIABLE_LIMITS.valueBytes) throw new Error("Variable value exceeds 4096 bytes");
}
export function freezeVariableSnapshot(raw: unknown, owner: string, workflowId?: string): VariableSnapshot {
  const data = raw as VariableSnapshot;
  if (!data || data.schemaVersion !== 1 || data.owner !== owner || data.workflowId !== workflowId || !/^\d+$/.test(data.revision) || !Number.isFinite(data.loadedAt) || !Array.isArray(data.entries) || data.entries.length > VARIABLE_LIMITS.count)
    throw new Error("Invalid variable snapshot");
  const values: Record<string, VariableValue> = Object.create(null);
  const entries = data.entries.map(entry => {
    validateVariable(entry.key, entry.value);
    const type = entry.value === null ? "null" : typeof entry.value;
    if (Object.prototype.hasOwnProperty.call(values, entry.key) || entry.value_type !== type || typeof entry.updated_at !== "string") throw new Error("Invalid variable snapshot");
    values[entry.key] = entry.value;
    return Object.freeze({ key: entry.key, value: entry.value, value_type: type, updated_at: entry.updated_at });
  });
  if (new TextEncoder().encode(JSON.stringify(entries)).length > VARIABLE_LIMITS.snapshotBytes) throw new Error("Variable snapshot exceeds 65536 bytes");
  return Object.freeze({ schemaVersion: 1, owner, ...(workflowId ? { workflowId } : {}), revision: data.revision, loadedAt: data.loadedAt, values: Object.freeze(values), entries: Object.freeze(entries) });
}
export function emptyVariableSnapshot(owner: string, workflowId?: string): VariableSnapshot {
  return freezeVariableSnapshot({ schemaVersion: 1, owner, workflowId, revision: "0", loadedAt: Date.now(), entries: [] }, owner, workflowId);
}
export function referencesVariables(value: unknown): boolean {
  if (typeof value === "string") {
    if (!value.includes("{{") || !/\$vars\b/.test(value)) return false;
    try { return compileEditTemplate(value, TYPED_EXPRESSION_FEATURES).hasVariables; }
    catch { return true; }
  }
  if (Array.isArray(value)) return value.some(referencesVariables);
  if (!value || typeof value !== "object") return false;
  const fields = value as Record<string, any>;
  if (fields.valueMode === "fixed") return false;
  if (fields.valueMode === "expression") return referencesVariables(fields.value);
  return Object.entries(fields).some(([key, item]) => key !== "__fieldValueModes" && fields.__fieldValueModes?.[key] !== "fixed" && referencesVariables(item));
}

export interface VariableChange { key: string; value: VariableValue }
export function overlayVariables(snapshot: VariableSnapshot, changes: readonly VariableChange[]): VariableSnapshot {
  const entries = new Map(snapshot.entries.map(entry => [entry.key, entry]));
  for (const { key, value } of changes) {
    validateVariable(key, value);
    entries.set(key, { key, value, value_type: value === null ? "null" : typeof value, updated_at: new Date().toISOString() });
  }
  return freezeVariableSnapshot({ ...snapshot, loadedAt: Date.now(), entries: [...entries.values()] }, snapshot.owner, snapshot.workflowId);
}

export function isPersistentVariableEdit(node: any): boolean {
  return (node.name === "Edit Fields" || node.type === "Edit Fields" || node.data?.definition?.name === "Edit Fields")
    && node.values?.persistent === true && Array.isArray(node.values.fields)
    && node.values.fields.some(isTypedEditFieldRow);
}
