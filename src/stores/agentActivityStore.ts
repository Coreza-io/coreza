import { useCallback, useSyncExternalStore } from "react";
import type { AgentActivityEvent, AgentActivitySummary } from "../../coreza-backend/src/agents/activity";

type ActivitySpan = Omit<AgentActivityEvent, "state"> & { state: AgentActivityEvent["state"] | "incomplete" };
export interface ManualAgentActivity {
  scopeId: string;
  sessionId: string;
  clientInvocationId: string;
  agentNodeId: string;
  attachmentEdges: readonly { id: string; source: string; target: string }[];
  participants: ReadonlySet<string>;
  spans: ReadonlyMap<string, ActivitySpan>;
  sequence: number;
  invocationId?: string;
  state: "pending" | "started" | "completed" | "failed" | "cancelled" | "incomplete";
  traceGap: boolean;
}
const invocations = new Map<string, ManualAgentActivity>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<() => void>();
let notificationQueued = false;
const key = (session: string, node: string) => JSON.stringify([session, node]);
const emptySnapshot = () => undefined;
function notify(record: ManualAgentActivity): void {
  for (const id of record.participants) for (const listener of listeners.get(key(record.sessionId, id)) ?? []) pending.add(listener);
  if (notificationQueued) return;
  notificationQueued = true;
  queueMicrotask(() => { notificationQueued = false; const batch = [...pending]; pending.clear(); batch.forEach(listener => listener()); });
}
export function beginAgentActivity(record: Omit<ManualAgentActivity, "spans" | "sequence" | "state" | "traceGap">): void {
  for (const [id, previous] of invocations) if (previous.sessionId === record.sessionId && previous.agentNodeId === record.agentNodeId) {
    invocations.delete(id); notify(previous);
  }
  while (invocations.size >= 64) { const oldest = invocations.keys().next().value!; const previous = invocations.get(oldest)!; invocations.delete(oldest); notify(previous); }
  const next: ManualAgentActivity = { ...record, spans: new Map(), sequence: 0, state: "pending", traceGap: false };
  invocations.set(record.scopeId, next); notify(next);
}
export function receiveAgentActivity(scopeId: string, events: AgentActivityEvent[], traceGap = false): void {
  const current = invocations.get(scopeId);
  if (!current || ["completed", "failed", "cancelled"].includes(current.state)) return;
  const spans = new Map(current.spans);
  let sequence = current.sequence;
  let state = current.state;
  let invocationId = current.invocationId;
  for (const event of events) {
    if (event.version !== 1 || event.clientInvocationId !== current.clientInvocationId || event.agentNodeId !== current.agentNodeId
      || !current.participants.has(event.participantNodeId ?? event.agentNodeId)
      || event.sequence <= sequence || (invocationId && invocationId !== event.agentInvocationId)) continue;
    if (event.sequence > sequence + 1) traceGap = true;
    invocationId = event.agentInvocationId;
    sequence = event.sequence;
    spans.set(event.spanId, event);
    if (event.phase === "agent") state = event.state;
    // Active spans are never evicted to retain correct participant refcounts.
    if (spans.size > 192) for (const [id, span] of spans) {
      if (span.state !== "started" && span.phase !== "agent") { spans.delete(id); break; }
    }
  }
  if (["completed", "failed", "cancelled"].includes(state)) for (const [id, span] of spans)
    if (span.state === "started") spans.set(id, { ...span, state: state === "completed" ? "incomplete" : state as "failed" | "cancelled" });
  const next = { ...current, spans, sequence, state, invocationId, traceGap: current.traceGap || traceGap };
  invocations.set(scopeId, next); notify(next);
}
export function receiveAgentActivitySnapshot(scopeId: string, summary: AgentActivitySummary): void {
  const current = invocations.get(scopeId);
  if (!current || ["completed", "failed", "cancelled"].includes(current.state)
    || summary.sequence < current.sequence || (current.invocationId && current.invocationId !== summary.agentInvocationId)) return;
  const valid = summary.spans.filter(span => span.clientInvocationId === current.clientInvocationId
    && span.agentNodeId === current.agentNodeId && current.participants.has(span.participantNodeId ?? span.agentNodeId));
  if (!valid.length) return;
  const next: ManualAgentActivity = { ...current, invocationId: summary.agentInvocationId,
    spans: new Map(valid.map(span => [span.spanId, span])), sequence: summary.sequence,
    state: summary.state, traceGap: current.traceGap || summary.traceGap };
  invocations.set(scopeId, next); notify(next);
}
export function reconcileAgentActivity(scopeId: string, summary?: AgentActivitySummary, fallback: ManualAgentActivity["state"] = "incomplete"): void {
  const current = invocations.get(scopeId);
  if (!current) return;
  // A cancelled/superseded action cannot be revived by a late HTTP or socket result.
  if (["completed", "failed", "cancelled"].includes(current.state)) return;
  if (summary) receiveAgentActivity(scopeId, summary.spans.slice().sort((a, b) => a.sequence - b.sequence), summary.traceGap);
  const latest = invocations.get(scopeId)!;
  const state = summary?.state && summary.state !== "started" ? summary.state : fallback;
  const spans = new Map(latest.spans);
  for (const [id, span] of spans) if (span.state === "started") spans.set(id, { ...span, state: state === "incomplete" || state === "completed" ? "incomplete" : state === "failed" ? "failed" : "cancelled" });
  const next = { ...latest, spans, state, traceGap: latest.traceGap || !summary || state === "incomplete" };
  invocations.set(scopeId, next); notify(next);
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
  return useSyncExternalStore(useCallback(listener => subscribe(sessionId, nodeIds, listener), [sessionId, signature]),
    useCallback(() => [...invocations.values()].some(record => record.sessionId === sessionId
      && record.state === "started" && (!edgeId || record.attachmentEdges.some(edge => edge.id === edgeId))
      && [...record.spans.values()].some(span => span.state === "started" && nodeIds.includes(span.participantNodeId ?? record.agentNodeId)
        && (!edgeId || record.attachmentEdges.some(edge => edge.id === edgeId && edge.source === span.participantNodeId && edge.target === record.agentNodeId)))),
    [sessionId, signature, edgeId]), () => false);
}
