import { apiClient } from "@/lib/apiClient";
import { beginAgentActivity, receiveAgentActivity, receiveAgentActivitySnapshot, reconcileAgentActivity } from "@/stores/agentActivityStore";
import type { AgentActivitySummary } from "../../coreza-backend/src/agents/activity";

/** Optional process-local manual activity. No request retry or execution ownership. */
export async function startManualAgentActivity(payload: Record<string, any>, token: string, signal?: AbortSignal) {
  if (import.meta.env.VITE_AGENT_ACTIVITY_ENABLED === "false") return undefined;
  const clientInvocationId = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
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
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const closeSocket = () => { if (watchdog) clearTimeout(watchdog); try { socket?.close(); } catch { /* connecting */ } };
  const cancel = () => {
    if (closed) return;
    if (scopeId) {
      reconcileAgentActivity(scopeId, undefined, "cancelled");
      void apiClient.request(`/aiagent/activity-scopes/${scopeId}/cancel`, { method: "POST", token, keepalive: true }).catch(() => {});
    }
    closeSocket();
  };
  try {
    if (signal?.aborted) return undefined;
    const res = await apiClient.request("/aiagent/activity-scopes", { method: "POST", token, signal: setup.signal, body: JSON.stringify(binding) });
    if (!res.ok) return undefined;
    scopeId = (await res.json()).scopeId;
    if (!scopeId) return undefined;
    payload.activityScopeId = scopeId;
    payload.clientInvocationId = clientInvocationId;
    payload.activityRevision = activityRevision;
    beginAgentActivity({ scopeId: scopeId!, sessionId: payload.workflowSessionId, clientInvocationId,
      agentNodeId: payload.node_id, attachmentEdges: binding.edges,
      participants: new Set([payload.node_id, ...binding.support_nodes.map((node: any) => node.id)]) });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const api = new URL(import.meta.env.VITE_BACKEND_URL || "http://localhost:8000");
    const wsUrl = import.meta.env.VITE_WS_URL || `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.hostname}:${import.meta.env.VITE_WS_PORT || (api.port === "8000" || !api.port ? "8080" : api.port)}`;
    socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000);
      const ready = () => { clearTimeout(timer); resolve(); };
      socket!.onopen = () => {
        if (closed || signal?.aborted) { closeSocket(); ready(); return; }
        socket!.send(JSON.stringify({ type: "subscribe_agent_activity", payload: { scopeId } }));
      };
      socket!.onmessage = event => {
        if (closed || signal?.aborted) return;
        try {
          const message = JSON.parse(event.data);
          if (message.payload?.scopeId !== scopeId) return;
          if (message.type === "agent_activity" || message.type === "agent_activity_subscribed") {
            receiveAgentActivity(scopeId!, message.payload.events ?? [], message.payload.traceGap);
            if (message.type === "agent_activity_subscribed") {
              if (message.payload.summary) receiveAgentActivitySnapshot(scopeId!, message.payload.summary);
              ready();
            }
          } else if (message.type === "agent_activity_unavailable") { closeSocket(); ready(); }
        } catch { /* malformed telemetry is not an action failure */ }
      };
      socket!.onerror = () => { closeSocket(); ready(); };
      socket!.onclose = () => { if (!closed) reconcileAgentActivity(scopeId!, undefined, "incomplete"); ready(); };
    });
  } catch {
    closeSocket();
    // Registration/socket setup is optional. The original Agent POST still executes once.
  } finally {
    clearTimeout(setupTimeout);
    signal?.removeEventListener("abort", abortSetup);
  }
  if (!scopeId) return undefined;
  watchdog = setTimeout(() => { reconcileAgentActivity(scopeId!, undefined, "incomplete"); closeSocket(); }, 10 * 60_000);
  return {
    cancel,
    finish(summary?: AgentActivitySummary, state: "completed" | "failed" | "cancelled" | "incomplete" = "incomplete") {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cancel);
      try { reconcileAgentActivity(scopeId!, summary, state); }
      catch { reconcileAgentActivity(scopeId!, undefined, "incomplete"); }
      closeSocket();
    },
  };
}
