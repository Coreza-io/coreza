/** Runtime identity is separate from the editor document/session identity. */
export interface EditorExecutionScope {
  sessionId: string;
  mode: "manual" | "batch";
  batchId?: string;
  createdAt: number;
}
const sessions = new Map<string, EditorExecutionScope>();
const locks = new Map<symbol, EditorExecutionScope>();
export function editorSessionExecutionScope(sessionId: string): EditorExecutionScope {
  let scope = sessions.get(sessionId);
  if (!scope) {
    scope = { sessionId, mode: "manual", createdAt: Date.now() };
    sessions.set(sessionId, scope);
  }
  return scope;
}
export function bindEditorExecutionScope(token: symbol, sessionId: string): void {
  locks.set(token, editorSessionExecutionScope(sessionId));
}
export function selectEditorBatchExecutionScope(token: symbol, sessionId: string): void {
  if (locks.get(token)?.sessionId !== sessionId) throw new Error("Execution scope is no longer active");
  locks.set(token, { sessionId, mode: "batch", batchId: crypto.randomUUID(), createdAt: Date.now() });
}
export function selectedEditorExecutionScope(sessionId: string, token?: symbol): EditorExecutionScope {
  if (!token) return editorSessionExecutionScope(sessionId);
  const scope = locks.get(token);
  if (!scope || scope.sessionId !== sessionId) throw new Error("Execution scope is no longer active");
  return scope;
}
export function releaseEditorExecutionScope(token: symbol): void { locks.delete(token); }
export function clearEditorExecutionScopes(sessionId: string): void {
  sessions.delete(sessionId);
  for (const [token, scope] of locks) if (scope.sessionId === sessionId) locks.delete(token);
}
