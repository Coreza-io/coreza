import { createHash, randomUUID } from "crypto";
import type { AgentActivityEvent, AgentActivityRecorder, AgentActivitySummary } from "./activity";

interface Scope {
  userId: string;
  binding: string;
  expires: number;
  started: boolean;
  controller: AbortController;
  recorder?: AgentActivityRecorder;
  events: AgentActivityEvent[];
  pending: AgentActivityEvent[];
  listeners: Set<(message: unknown) => void>;
  timer?: ReturnType<typeof setTimeout>;
  traceGap: boolean;
}
const scopes = new Map<string, Scope>();
const enabled = () => process.env.AGENT_ACTIVITY_ENABLED !== "false";

// Only a server-issued action scope grants access. No stored workflow/run is
// authorized by a caller's workflowId. Draft and saved manual actions use this path.
export function verifyActivityRevision(payload: any): boolean {
  const { activityScopeId, clientInvocationId, activityRevision, ...execution } = payload;
  return createHash("sha256").update(JSON.stringify(execution)).digest("hex") === activityRevision;
}
export function activityBinding(payload: any): string {
  return createHash("sha256").update(JSON.stringify([
    payload.workflowId ?? null, payload.workflowSessionId, payload.node_id,
    payload.clientInvocationId, payload.activityRevision,
    (payload.support_nodes ?? []).map((node: any) => node.id),
    (payload.edges ?? []).map((edge: any) => [edge.id, edge.source, edge.target, edge.sourceHandle, edge.targetHandle]),
  ])).digest("hex");
}
function sweep(): void {
  for (const [id, scope] of scopes) if (scope.expires < Date.now()) {
    if (!scope.started || scope.recorder?.snapshot().state !== "started") {
      if (scope.timer) clearTimeout(scope.timer);
      scopes.delete(id);
    }
  }
}
export function registerActivity(userId: string, binding: string): string {
  if (!enabled()) throw new Error("Agent activity disabled");
  sweep();
  // Prefer evicting completed traces over losing visibility in repeated Loops.
  for (const [id, scope] of scopes) {
    if (scopes.size < 64 && [...scopes.values()].filter(item => item.userId === userId).length < 16) break;
    if (scope.recorder && scope.recorder.snapshot().state !== "started") {
      if (scope.timer) clearTimeout(scope.timer);
      scopes.delete(id);
    }
  }
  if (scopes.size >= 64 || [...scopes.values()].filter(scope => scope.userId === userId).length >= 16)
    throw new Error("Agent activity capacity reached");
  const id = randomUUID();
  scopes.set(id, { userId, binding, expires: Date.now() + 300_000, started: false,
    controller: new AbortController(), events: [], pending: [], listeners: new Set(), traceGap: false });
  return id;
}
function owned(userId: string, id: string): Scope {
  sweep();
  const scope = scopes.get(id);
  if (!scope || scope.userId !== userId) throw new Error("Agent activity scope unavailable");
  return scope;
}
function flush(scope: Scope): void {
  scope.timer = undefined;
  const events = scope.pending.splice(0);
  for (const listener of scope.listeners) {
    try { listener({ events, traceGap: scope.traceGap }); } catch { scope.traceGap = true; }
  }
}
export function subscribeActivity(userId: string, id: string, listener: (message: unknown) => void): () => void {
  const scope = owned(userId, id);
  if (scope.listeners.size >= 2) throw new Error("Agent activity subscriber limit reached");
  scope.listeners.add(listener);
  return () => { scope.listeners.delete(listener); };
}
export function activitySnapshot(userId: string, id: string) {
  const scope = owned(userId, id);
  return { events: scope.events.slice(), summary: scope.recorder?.snapshot(), traceGap: scope.traceGap };
}
export function claimActivity(userId: string, id: string, binding: string) {
  const scope = owned(userId, id);
  if (scope.binding !== binding || scope.started) throw new Error("Agent activity scope does not match this action");
  scope.started = true;
  // Registry expiry bounds retention; the manual route owns the execution deadline.
  scope.expires = Date.now() + 30 * 60_000;
  return {
    signal: scope.controller.signal,
    attach(recorder: AgentActivityRecorder) { scope.recorder = recorder; },
    emit(event: AgentActivityEvent) {
      if (Buffer.byteLength(JSON.stringify(event)) > 1024) { scope.traceGap = true; return; }
      scope.events.push(event);
      if (scope.events.length > 256) { scope.events.shift(); scope.traceGap = true; }
      if (scope.pending.length >= 256) { scope.pending.shift(); scope.traceGap = true; }
      scope.pending.push(event);
      if (event.phase === "agent" && event.state !== "started") {
        if (scope.timer) clearTimeout(scope.timer);
        scope.timer = undefined;
        scope.expires = Date.now() + 300_000;
        // Defer delivery so emit performs only bounded in-memory work.
        scope.timer = setTimeout(() => flush(scope), 0);
      } else if (!scope.timer) scope.timer = setTimeout(() => flush(scope), 20);
    },
  };
}
export function cancelActivity(userId: string, id: string): void {
  const scope = owned(userId, id);
  scope.controller.abort();
}
export function getActivitySummary(userId: string, id: string): AgentActivitySummary | undefined {
  try {
    const scope = owned(userId, id);
    const summary = scope.recorder?.snapshot();
    return summary ? { ...summary, traceGap: summary.traceGap || scope.traceGap } : undefined;
  } catch { return undefined; } // Retention/export faults cannot replace the HTTP result.
}
