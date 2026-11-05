import { useCallback, useSyncExternalStore } from "react";
import type { AgentActivityEvent, AgentActivitySummary } from "../../coreza-backend/src/agents/activity";

type ActivitySpan = Omit<AgentActivityEvent, "state"> & { state: AgentActivityEvent["state"] | "incomplete" };
export interface ManualAgentActivity {
  scopeId: string;
  sessionId: string;
  executionSessionId?: string;
  clientInvocationId: string;
  agentNodeId: string;
  attachmentEdges: readonly { id: string; source: string; target: string }[];
  participants: ReadonlySet<string>;
  spans: ReadonlyMap<string, ActivitySpan>;
  sequence: number;
  invocationId?: string;
  state: "pending" | "started" | "completed" | "failed" | "cancelled" | "incomplete";
  traceGap: boolean;
  acceptingEvents: boolean;
  cancelledLocally: boolean;
  cancel?: () => void;
}
const invocations = new Map<string, ManualAgentActivity>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<() => void>();
let notificationQueued = false;
const key = (session: string, node: string) => JSON.stringify([session, node]);
const emptySnapshot = () => undefined;
function notify(record: ManualAgentActivity, affected: ReadonlySet<string> = record.participants): void {
  for (const id of affected) for (const listener of listeners.get(key(record.sessionId, id)) ?? []) pending.add(listener);
  if (notificationQueued) return;
  notificationQueued = true;
  queueMicrotask(() => { notificationQueued = false; const batch = [...pending]; pending.clear(); batch.forEach(listener => listener()); });
}
export function beginAgentActivity(record: Omit<ManualAgentActivity, "spans" | "sequence" | "state" | "traceGap" | "acceptingEvents" | "cancelledLocally">): void {
  for (const [id, previous] of invocations) if (previous.sessionId === record.sessionId && previous.agentNodeId === record.agentNodeId) {
    invocations.delete(id); notify(previous);
  }
  while (invocations.size >= 64) { const oldest = invocations.keys().next().value!; const previous = invocations.get(oldest)!; invocations.delete(oldest); notify(previous); }
  const next: ManualAgentActivity = { ...record, spans: new Map(), sequence: 0, state: "pending", traceGap: false, acceptingEvents: true, cancelledLocally: false };
  invocations.set(record.scopeId, next); notify(next);
}
const terminal = (state: ManualAgentActivity["state"]): boolean =>
  state === "completed" || state === "failed" || state === "cancelled";
function belongsTo(record: ManualAgentActivity, event: AgentActivityEvent): boolean {
  return event.version === 1 && event.clientInvocationId === record.clientInvocationId
    && event.agentNodeId === record.agentNodeId && event.workflowExecutionId === (record.executionSessionId ?? record.sessionId)
    && record.participants.has(event.participantNodeId ?? event.agentNodeId)
    && Number.isSafeInteger(event.sequence) && event.sequence > 0;
}
function closeActive(spans: Map<string, ActivitySpan>, state: ManualAgentActivity["state"]): void {
  for (const [id, span] of spans) if (span.state === "started") spans.set(id, { ...span,
    state: state === "cancelled" || state === "failed" ? state : "incomplete" });
}
export function receiveAgentActivity(scopeId: string, events: AgentActivityEvent[], traceGap = false): void {
  const current = invocations.get(scopeId);
  if (!current?.acceptingEvents) return;
  const spans = new Map(current.spans);
  const affected = new Set([current.agentNodeId]);
  let sequence = current.sequence;
  let state = current.state;
  let invocationId = current.invocationId;
  for (const event of events) {
    if (!belongsTo(current, event) || (invocationId && invocationId !== event.agentInvocationId)) continue;
    const previous = spans.get(event.spanId);
    if (previous && previous.sequence >= event.sequence) continue;
    if (event.sequence > sequence + 1) traceGap = true;
    invocationId = event.agentInvocationId;
    // Order each span separately: an earlier terminal event can arrive after a
    // newer operation's start. A global watermark must not discard that terminal.
    sequence = Math.max(sequence, event.sequence);
    spans.set(event.spanId, event);
    affected.add(event.participantNodeId ?? current.agentNodeId);
    if (event.phase === "agent" && (!terminal(state) || event.state !== "started")) state = event.state;
    if (spans.size > 192) for (const [id, span] of spans) {
      if (span.state !== "started" && span.phase !== "agent") { spans.delete(id); traceGap = true; break; }
    }
  }
  if (terminal(state)) closeActive(spans, state);
  const next = { ...current, spans, sequence, state, invocationId,
    acceptingEvents: !terminal(state), cancel: terminal(state) ? undefined : current.cancel, traceGap: current.traceGap || traceGap };
  invocations.set(scopeId, next); notify(next, terminal(state) ? next.participants : affected);
}
export function receiveAgentActivitySnapshot(scopeId: string, summary: AgentActivitySummary): void {
  const current = invocations.get(scopeId);
  if (!current?.acceptingEvents || summary.sequence < current.sequence) return;
  applySummary(current, summary, summary.state);
}
function applySummary(current: ManualAgentActivity, summary: AgentActivitySummary | undefined, fallback: ManualAgentActivity["state"]): void {
  const validSummary = summary && (!current.invocationId || current.invocationId === summary.agentInvocationId)
    && Array.isArray(summary.spans) && summary.sequence >= current.sequence ? summary : undefined;
  const spans = new Map(current.spans);
  if (validSummary) for (const span of validSummary.spans) {
    if (span.agentInvocationId !== validSummary.agentInvocationId || !belongsTo(current, span)) continue;
    const previous = spans.get(span.spanId);
    // HTTP is authoritative and may repair an inferred incomplete span even
    // after the socket has already delivered the parent terminal event.
    if (!previous || previous.sequence <= span.sequence) spans.set(span.spanId, span);
  }
  while (spans.size > 192) {
    const removable = [...spans].find(([, span]) => span.state !== "started" && span.phase !== "agent");
    if (!removable) break;
    spans.delete(removable[0]);
  }
  const state = validSummary && terminal(validSummary.state) ? validSummary.state
    : terminal(current.state) ? current.state : fallback;
  if (state !== "started" && state !== "pending") closeActive(spans, state);
  const next: ManualAgentActivity = { ...current, spans, state,
    sequence: validSummary?.sequence ?? current.sequence,
    invocationId: validSummary?.agentInvocationId ?? current.invocationId,
    acceptingEvents: current.acceptingEvents && !terminal(state),
    cancel: terminal(state) ? undefined : current.cancel,
    traceGap: (validSummary ? validSummary.traceGap : current.traceGap || !summary) || state === "incomplete" };
  invocations.set(current.scopeId, next); notify(next);
}
/** Stop accepting pushes without claiming the underlying execution succeeded. */
export function interruptAgentActivity(scopeId: string, cancelled = false): void {
  const current = invocations.get(scopeId);
  if (!current || current.cancelledLocally) return;
  const state = cancelled ? "cancelled" : terminal(current.state) ? current.state : "incomplete";
  const spans = new Map(current.spans);
  closeActive(spans, state);
  const next: ManualAgentActivity = { ...current, spans, state, acceptingEvents: false,
    cancelledLocally: cancelled, cancel: cancelled ? undefined : current.cancel, traceGap: current.traceGap || !terminal(state) };
  invocations.set(scopeId, next); notify(next);
}
export function reconcileAgentActivity(scopeId: string, summary?: AgentActivitySummary, fallback: ManualAgentActivity["state"] = "incomplete"): void {
  const current = invocations.get(scopeId);
  if (!current || current.cancelledLocally) return;
  if (fallback === "cancelled") { interruptAgentActivity(scopeId, true); return; }
  applySummary(current, summary, fallback);
  const latest = invocations.get(scopeId)!;
  invocations.set(scopeId, { ...latest, acceptingEvents: false, cancel: undefined });
}
export function clearAgentActivity(sessionId: string): void {
  for (const [id, record] of invocations) if (record.sessionId === sessionId) { invocations.delete(id); notify(record); }
}
function subscribe(sessionId: string, nodeIds: readonly string[], listener: () => void): () => void {
  const keys = nodeIds.map(id => key(sessionId, id));
  for (const k of keys) { const set = listeners.get(k) ?? new Set(); set.add(listener); listeners.set(k, set); }
  return () => { for (const k of keys) { const set = listeners.get(k); set?.delete(listener); if (!set?.size) listeners.delete(k); } };
}
export function getAgentActivity(sessionId: string, nodeId: string): ManualAgentActivity | undefined {
  return [...invocations.values()].find(record => record.sessionId === sessionId && record.agentNodeId === nodeId);
}
export function useAgentTimeline(sessionId: string, nodeId: string): ManualAgentActivity | undefined {
  return useSyncExternalStore(useCallback(listener => subscribe(sessionId, [nodeId], listener), [sessionId, nodeId]),
    useCallback(() => getAgentActivity(sessionId, nodeId), [sessionId, nodeId]), emptySnapshot);
}
export function useAgentParticipantActive(sessionId: string, nodeIds: readonly string[], edgeId?: string): boolean {
  const signature = JSON.stringify(nodeIds);
  return useSyncExternalStore(useCallback(listener => subscribe(sessionId, edgeId ? nodeIds.slice(0, 1) : nodeIds, listener), [sessionId, signature, edgeId]),
    useCallback(() => [...invocations.values()].some(record => record.sessionId === sessionId
      && record.state === "started" && (!edgeId || record.attachmentEdges.some(edge => edge.id === edgeId))
      && [...record.spans.values()].some(span => span.state === "started" && nodeIds.includes(span.participantNodeId ?? record.agentNodeId)
        && (!edgeId || record.attachmentEdges.some(edge => edge.id === edgeId && edge.source === span.participantNodeId && edge.target === record.agentNodeId)))),
    [sessionId, signature, edgeId]), () => false);
}
