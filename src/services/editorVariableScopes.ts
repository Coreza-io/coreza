import { supabase } from "@/integrations/supabase/client";
import { apiClient } from "@/lib/apiClient";
import { freezeVariableSnapshot, type VariableSnapshot } from "../../coreza-backend/src/variables/contract";
import type { EditorVariableScope } from "../../coreza-backend/src/variables/editorScope";
export type { EditorVariableScope };
interface ScopeState {
  scope: EditorVariableScope;
  owner?: string;
  workflowId?: string;
  token?: string;
  opened?: Promise<VariableSnapshot>;
  closed: boolean;
  renewal?: ReturnType<typeof setInterval>;
  error?: unknown;
  clear: Map<object, () => void>;
}
const sessions = new Map<string, ScopeState>();
const locks = new Map<symbol, ScopeState>();
const sessionGenerations = new Map<string, number>();
export function activateEditorSessionVariables(sessionId: string): void {
  sessionGenerations.set(sessionId, (sessionGenerations.get(sessionId) ?? 0) + 1);
}
const stateFor = (scope: EditorVariableScope) => {
  const state = [...sessions.values(), ...locks.values()].find(state => state.scope === scope);
  if (!state || state.closed) throw new Error("Variable scope closed; reload the editor");
  if (state.error) throw state.error;
  return state;
};
export function editorVariableScope(sessionId: string): EditorVariableScope {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { scope: { sessionId, mode: "manual", createdAt: Date.now() }, closed: false, clear: new Map() };
    sessions.set(sessionId, state);
  }
  return state.scope;
}
export function bindEditorVariableLock(token: symbol, sessionId: string): void {
  editorVariableScope(sessionId);
  const state = sessions.get(sessionId)!;
  if (state.closed) throw new Error("Editor variable scope closed");
  locks.set(token, state);
  if (state.opened && !state.renewal) state.renewal = setInterval(() => {
    void operation(state, "touch").catch(error => { state.error = error; });
  }, 60 * 60 * 1000);
}
export function selectEditorBatchVariables(token: symbol, sessionId: string): void {
  const previous = locks.get(token);
  if (!previous) throw new Error("Execution lock is no longer active");
  if (previous.renewal) clearInterval(previous.renewal);
  previous.renewal = undefined;
  locks.set(token, { scope: { sessionId, mode: "batch", batchId: crypto.randomUUID(), createdAt: Date.now() }, closed: false, clear: new Map() });
}
export function selectedEditorVariableScope(sessionId: string, token?: symbol): EditorVariableScope {
  return (token ? locks.get(token)?.scope : undefined) ?? editorVariableScope(sessionId);
}
export function activeEditorVariableScope(sessionId: string): EditorVariableScope {
  return [...locks.values()].find(state => state.scope.sessionId === sessionId)?.scope ?? editorVariableScope(sessionId);
}
export const variableQueryKey = (owner: string | undefined, workflowId: string | undefined, scope: EditorVariableScope) =>
  ["workflow-variables", owner, workflowId, scope.sessionId, scope.mode, scope.batchId ?? "manual", scope.createdAt] as const;
export function bindEditorVariableOwner(scope: EditorVariableScope, owner: string, workflowId: string, token?: string, clear?: () => void, cacheOwner?: object) {
  const state = stateFor(scope);
  if (state.owner && (state.owner !== owner || state.workflowId !== workflowId)) throw new Error("Variable scope owner changed");
  state.owner = owner; state.workflowId = workflowId; state.token = token;
  if (clear) state.clear.set(cacheOwner ?? clear, clear);
  return state;
}
async function operation(state: ScopeState, operation: "open" | "touch" | "close") {
  if (operation === "touch") {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || state.closed || session.user.id !== state.owner) throw new Error("Variable scope owner changed");
    state.token = session.access_token;
  }
  const response = await apiClient.request(`/variables/scope/${operation}`, {
    method: "POST", token: state.token, keepalive: operation === "close",
    body: JSON.stringify({ workflowId: state.workflowId, variableScope: state.scope }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? body.message ?? "Variable scope unavailable");
  return body;
}
export async function openEditorVariables(scope: EditorVariableScope, owner: string, workflowId: string, token?: string): Promise<VariableSnapshot> {
  const state = bindEditorVariableOwner(scope, owner, workflowId, token);
  // Open only once. After expiry/close, execution must never silently reseed.
  state.opened ??= operation(state, "open").then(raw => {
    if (state.closed) throw new Error("Variable scope closed");
    return freezeVariableSnapshot(raw, owner, workflowId);
  });
  await state.opened;
  if (state.closed) throw new Error("Variable scope closed");
  if (!state.renewal && [...locks.values()].includes(state)) {
    state.renewal = setInterval(() => {
      void operation(state, "touch").catch(error => { state.error = error; });
    }, 60 * 60 * 1000);
  }
  // A later manual action must see prior commits, not the initial open snapshot.
  return freezeVariableSnapshot(await operation(state, "touch"), owner, workflowId);
}
export async function renewEditorVariables(scope: EditorVariableScope): Promise<void> {
  const state = stateFor(scope);
  if (state.opened) await operation(state, "touch");
}
async function close(state: ScopeState): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  if (state.renewal) clearInterval(state.renewal);
  state.renewal = undefined;
  state.opened = undefined;
  state.clear.forEach(clear => clear()); state.clear.clear();
  try {
    if (state.owner && state.workflowId) await operation(state, "close");
  } finally {
    state.token = undefined;
    state.owner = undefined;
    state.workflowId = undefined;
  }
}
export async function releaseEditorVariableLock(token: symbol): Promise<void> {
  const state = locks.get(token);
  locks.delete(token);
  if (state?.renewal) clearInterval(state.renewal);
  if (state) state.renewal = undefined;
  if (state?.scope.mode === "batch") await close(state);
}
export function closeEditorSessionVariables(sessionId: string): void {
  const generation = sessionGenerations.get(sessionId);
  queueMicrotask(() => {
    if (sessionGenerations.get(sessionId) !== generation) return;
    disposeEditorSessionVariables(sessionId);
  });
}
function disposeEditorSessionVariables(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state) void close(state).catch(() => { /* TTL covers missed teardown. */ });
  for (const [token, active] of locks) if (active.scope.sessionId === sessionId) {
    locks.delete(token);
    if (active !== state) void close(active).catch(() => { /* TTL covers missed teardown. */ });
  }
}
