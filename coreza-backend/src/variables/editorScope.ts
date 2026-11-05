/** Identity only: clients never provide authoritative variable values. */
export interface EditorVariableScope {
  sessionId: string;
  mode: "manual" | "batch";
  batchId?: string;
  createdAt: number;
}
export const EDITOR_VARIABLE_IDLE_SECONDS = 24 * 60 * 60;
export function parseEditorVariableScope(raw: unknown): EditorVariableScope {
  const s = raw as EditorVariableScope;
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (!s || !uuid(s.sessionId) || !["manual", "batch"].includes(s.mode) ||
      (s.mode === "batch" ? !uuid(s.batchId) : s.batchId !== undefined) ||
      !Number.isSafeInteger(s.createdAt) || s.createdAt <= 0 || s.createdAt > Date.now() + 5000) {
    throw Object.assign(new Error("Refresh required: valid editor variable scope metadata is required"), { statusCode: 400 });
  }
  return { sessionId: s.sessionId, mode: s.mode, ...(s.batchId ? { batchId: s.batchId } : {}), createdAt: s.createdAt };
}
