import { apiClient } from "@/lib/apiClient";
import { beginAgentActivity, receiveAgentActivity, receiveAgentActivitySnapshot,
  interruptAgentActivity, reconcileAgentActivity } from "@/stores/agentActivityStore";
import type { AgentActivitySummary } from "../../coreza-backend/src/agents/activity";

/** Optional process-local manual activity. Never retries the execution request. */
export async function startManualAgentActivity(payload: Record<string, any>, token: string,
  signal?: AbortSignal, isCurrent = () => true, abortExecution?: () => void) {
  if (import.meta.env.VITE_AGENT_ACTIVITY_ENABLED === "false" || signal?.aborted || !isCurrent()) return undefined;
  const clientInvocationId = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  if (signal?.aborted || !isCurrent()) return undefined;
  const activityRevision = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const binding = { workflowId: payload.workflowId, workflowSessionId: payload.workflowSessionId,
    node_id: payload.node_id, clientInvocationId, activityRevision,
    support_nodes: (payload.support_nodes ?? []).map((node: any) => ({ id: node.id })), edges: payload.edges ?? [] };
  const setup = new AbortController();
  const setupTimeout = setTimeout(() => setup.abort(), 1500);
  const abortSetup = () => setup.abort();
  signal?.addEventListener("abort", abortSetup, { once: true });
  let socket: WebSocket | undefined;
  let scopeId: string | undefined;
  let closed = false;
  let cancelled = false;
  let watching = true;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const closeSocket = () => {
    watching = false;
    if (watchdog) clearTimeout(watchdog);
    try { socket?.close(); } catch { /* A connecting socket closes in onopen. */ }
  };
  const cancel = () => {
    if (closed || cancelled) return;
    cancelled = true;
    if (scopeId) {
      interruptAgentActivity(scopeId, true);
      void apiClient.request(`/aiagent/activity-scopes/${scopeId}/cancel`, { method: "POST", token, keepalive: true }).catch(() => {});
    }
    abortExecution?.();
    closeSocket();
  };
  const unavailable = () => {
    if (scopeId && !closed && !cancelled) interruptAgentActivity(scopeId);
    closeSocket();
  };
  try {
    if (signal?.aborted || !isCurrent()) return undefined;
    const res = await apiClient.request("/aiagent/activity-scopes", { method: "POST", token, signal: setup.signal, body: JSON.stringify(binding) });
    if (!res.ok) return undefined;
    scopeId = (await res.json()).scopeId;
    if (!scopeId) return undefined;
    if (signal?.aborted || !isCurrent()) { cancel(); return undefined; }
    payload.activityScopeId = scopeId;
    payload.clientInvocationId = clientInvocationId;
    payload.activityRevision = activityRevision;
    beginAgentActivity({ scopeId, sessionId: payload.workflowSessionId, clientInvocationId,
      agentNodeId: payload.node_id, attachmentEdges: binding.edges, cancel,
      participants: new Set([payload.node_id, ...binding.support_nodes.map((node: any) => node.id)]) });
    signal?.addEventListener("abort", cancel, { once: true });
    const api = new URL(import.meta.env.VITE_BACKEND_URL || "http://localhost:8000");
    // Use the backend's dedicated WebSocket port, not the editor/HTTP port.
    const wsUrl = import.meta.env.VITE_WS_URL || import.meta.env.VITE_BACKEND_WS_URL
      || `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.hostname}:${import.meta.env.VITE_WS_PORT || "8081"}`;
    socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { unavailable(); resolve(); }, 1000);
      const ready = () => { clearTimeout(timer); resolve(); };
      socket!.onopen = () => {
        if (!watching || closed || signal?.aborted || !isCurrent()) { closeSocket(); ready(); return; }
        socket!.send(JSON.stringify({ type: "subscribe_agent_activity", payload: { scopeId } }));
      };
      socket!.onmessage = event => {
        if (!watching || closed || signal?.aborted || !isCurrent()) return;
        try {
          const message = JSON.parse(event.data);
          if (message.payload?.scopeId !== scopeId) return;
          if (message.type === "agent_activity" || message.type === "agent_activity_subscribed") {
            receiveAgentActivity(scopeId!, message.payload.events ?? [], message.payload.traceGap);
            if (message.type === "agent_activity_subscribed") {
              if (message.payload.summary) receiveAgentActivitySnapshot(scopeId!, message.payload.summary);
              ready();
            }
          } else if (message.type === "agent_activity_unavailable") { unavailable(); ready(); }
        } catch { /* Malformed telemetry is not an action failure. */ }
      };
      socket!.onerror = () => { unavailable(); ready(); };
      socket!.onclose = () => { if (!closed) unavailable(); ready(); };
    });
  } catch {
    unavailable();
  } finally {
    clearTimeout(setupTimeout);
    signal?.removeEventListener("abort", abortSetup);
  }
  if (!scopeId) return undefined;
  if (watching) watchdog = setTimeout(unavailable, 10 * 60_000);
  return {
    cancel,
    finish(summary?: AgentActivitySummary, state: "completed" | "failed" | "cancelled" | "incomplete" = "incomplete") {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cancel);
      try { reconcileAgentActivity(scopeId!, summary, cancelled || signal?.aborted || !isCurrent() ? "cancelled" : state); }
      catch { interruptAgentActivity(scopeId!); }
      closeSocket();
    },
  };
}
