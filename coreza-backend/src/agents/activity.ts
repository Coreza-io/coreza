import { randomUUID } from "crypto";

export type ActivityState = "started" | "completed" | "failed" | "cancelled";
export interface AgentActivityEvent {
  version: 1;
  eventId: string;
  sequence: number;
  occurredAt: string;
  workflowId: string;
  workflowExecutionId: string;
  workflowRunId?: string;
  clientInvocationId?: string;
  agentInvocationId: string;
  agentNodeId: string;
  spanId: string;
  parentSpanId?: string;
  participantNodeId?: string;
  phase: "agent" | "model" | "memory" | "tool";
  operation?: "prepare" | "read" | "write";
  state: ActivityState;
  durationMs?: number;
}
export interface AgentActivitySummary {
  agentInvocationId: string;
  sequence: number;
  state: ActivityState;
  traceGap: boolean;
  spans: AgentActivityEvent[];
}
export interface AgentActivitySink { emit(event: AgentActivityEvent): void; }

type Identity = Pick<AgentActivityEvent, "workflowId" | "workflowExecutionId" | "workflowRunId" | "clientInvocationId" | "agentNodeId">;

/** Per invocation only. Observer failures never replace an execution result. */
export class AgentActivityRecorder {
  readonly invocationId = randomUUID();
  private sequence = 0;
  private active = new Map<string, { event: AgentActivityEvent; start: number }>();
  private recent: AgentActivityEvent[] = [];
  private rootId?: string;
  private state: ActivityState = "started";
  private traceGap = false;
  constructor(private readonly identity: Identity, private readonly sink?: AgentActivitySink) {}

  private emit(event: AgentActivityEvent): void {
    try { this.sink?.emit(event); } catch { this.traceGap = true; }
  }
  start(phase: AgentActivityEvent["phase"], participantNodeId?: string, operation?: AgentActivityEvent["operation"]): string {
    if (!this.sink || process.env.AGENT_ACTIVITY_ENABLED === "false") return "";
    const spanId = randomUUID();
    if (this.state !== "started" || this.active.size >= 128) { this.traceGap = true; return spanId; }
    const event: AgentActivityEvent = {
      ...this.identity, version: 1, eventId: randomUUID(), sequence: ++this.sequence,
      occurredAt: new Date().toISOString(), agentInvocationId: this.invocationId,
      agentNodeId: this.identity.agentNodeId, spanId, parentSpanId: this.rootId,
      participantNodeId, phase, operation, state: "started",
    };
    if (phase === "agent") this.rootId = spanId;
    this.active.set(spanId, { event, start: performance.now() });
    this.emit(event);
    return spanId;
  }
  end(spanId: string, state: Exclude<ActivityState, "started">): void {
    const span = this.active.get(spanId);
    if (!span) return;
    this.active.delete(spanId);
    const event: AgentActivityEvent = { ...span.event, eventId: randomUUID(), sequence: ++this.sequence,
      occurredAt: new Date().toISOString(), state, durationMs: Math.max(0, performance.now() - span.start) };
    this.recent.push(event);
    if (this.recent.length > 64) { this.recent.shift(); this.traceGap = true; }
    this.emit(event);
  }
  finish(state: Exclude<ActivityState, "started">): void {
    if (this.state !== "started") return;
    for (const id of this.active.keys()) if (id !== this.rootId) this.end(id, state === "completed" ? "cancelled" : state);
    if (this.rootId) this.end(this.rootId, state);
    this.state = state;
  }
  snapshot(): AgentActivitySummary {
    return { agentInvocationId: this.invocationId, sequence: this.sequence, state: this.state,
      traceGap: this.traceGap, spans: [...this.recent, ...[...this.active.values()].map(span => span.event)] };
  }
}

export function assertAgentActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Agent execution cancelled");
  error.name = "AbortError";
  throw error;
}
