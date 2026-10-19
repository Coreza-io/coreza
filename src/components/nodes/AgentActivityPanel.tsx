import { useAgentTimeline } from "@/stores/agentActivityStore";

export function AgentActivityPanel({ sessionId, nodeId }: { sessionId: string; nodeId: string }) {
  const activity = useAgentTimeline(sessionId, nodeId);
  if (!activity) return null;
  const spans = [...activity.spans.values()];
  const active = spans.filter(span => span.phase !== "agent" && span.state === "started");
  return (
    <details className="nodrag nopan mb-3 rounded border border-border p-2 text-xs" onPointerDown={event => event.stopPropagation()}>
      <summary className="cursor-pointer" aria-live="polite">
        Agent activity: {activity.state}{active.length ? ` · ${active.length} active` : ""}
      </summary>
      {activity.traceGap && <p className="mt-2 text-muted-foreground">Some activity detail is unavailable.</p>}
      <ol className="mt-2 max-h-48 space-y-1 overflow-auto" aria-label="Agent operation timeline">
        {spans.map((span, index) => <li key={span.spanId} className={span.state === "failed" ? "text-destructive" : ""}>
          {index + 1}. {span.participantNodeId || nodeId} · {span.phase}{span.operation ? ` ${span.operation}` : ""} · {span.state}
          {span.durationMs !== undefined ? ` · ${Math.round(span.durationMs)} ms` : ""}
        </li>)}
      </ol>
    </details>
  );
}
