import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";

export type ClusterRunPhase = "idle" | "preparing" | "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed" | "blocked";
export interface ClusterRunState { phase: ClusterRunPhase; runId?: string; reason?: string }

interface Options {
  token?: string;
  workflowSessionId: string;
  prepare: () => Promise<{ workflowId: string; revision: number } | null>;
  disabledReason?: string;
}

const terminalStatuses = new Set(["success", "succeeded", "completed", "failed", "cancelled"]);

export function useClusterExecution({ token, workflowSessionId, prepare, disabledReason }: Options) {
  const [states, setStates] = useState<Record<string, ClusterRunState>>({});
  const activeRef = useRef<{ clusterId: string; workflowId: string; runId: string; sessionId: string } | null>(null);
  const submittingRef = useRef(false);
  const sessionRef = useRef(workflowSessionId);
  const update = useCallback((clusterId: string, state: ClusterRunState) => setStates((current) => ({ ...current, [clusterId]: state })), []);

  useEffect(() => {
    sessionRef.current = workflowSessionId;
    activeRef.current = null;
    submittingRef.current = false;
    setStates({});
  }, [workflowSessionId]);

  useEffect(() => {
    const active = activeRef.current;
    if (!active || !["queued", "running", "cancelling"].includes(states[active.clusterId]?.phase)) return;
    const timer = window.setInterval(async () => {
      const current = activeRef.current;
      if (!current || current.runId !== active.runId || current.sessionId !== workflowSessionId) return;
      try {
        const response = await apiClient.get(`/workflows/${current.workflowId}/runs/${current.runId}/status`, token);
        if (!response.ok) return;
        const payload = await response.json() as { run?: { status?: string; error_message?: string | null } };
        const status = payload.run?.status?.toLowerCase();
        if (!status) return;
        if (status === "failed" || status === "cancelled") {
          update(current.clusterId, { phase: status, runId: current.runId, reason: payload.run?.error_message ?? (status === "cancelled" ? "Run cancelled" : "Cluster run failed") });
        } else if (["success", "succeeded", "completed"].includes(status)) {
          update(current.clusterId, { phase: "completed", runId: current.runId });
        } else {
          update(current.clusterId, { phase: status === "queued" ? "queued" : status === "cancelling" ? "cancelling" : "running", runId: current.runId });
        }
        if (terminalStatuses.has(status)) activeRef.current = null;
      } catch {
        // Polling is observational; transient failures must not change run state.
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [states, token, update, workflowSessionId]);

  const executeCluster = useCallback(async (clusterId: string) => {
    if (submittingRef.current || activeRef.current) return;
    if (disabledReason) return;
    const requestSessionId = workflowSessionId;
    submittingRef.current = true;
    update(clusterId, { phase: "preparing" });
    try {
      const saved = await prepare();
      if (sessionRef.current !== requestSessionId) return;
      if (!saved) return update(clusterId, { phase: "failed", reason: "Save the workflow before executing this cluster." });
      const response = await apiClient.post(`/workflows/${saved.workflowId}/execute`, {
        expected_revision: saved.revision,
        scope: { kind: "cluster", clusterId },
        idempotency_key: crypto.randomUUID(),
        input_data: {},
      }, token);
      const payload = await response.json() as { run_id?: string; status?: string; message?: string; code?: string };
      if (sessionRef.current !== requestSessionId) return;
      if (!response.ok || !payload.run_id) throw new Error(payload.message ?? payload.code ?? "Cluster execution could not be started");
      activeRef.current = { clusterId, workflowId: saved.workflowId, runId: payload.run_id, sessionId: requestSessionId };
      update(clusterId, { phase: payload.status === "running" ? "running" : "queued", runId: payload.run_id });
    } catch (error) {
      if (sessionRef.current === requestSessionId) {
        update(clusterId, { phase: "failed", reason: error instanceof Error ? error.message : "Cluster execution could not be started" });
      }
    } finally {
      submittingRef.current = false;
    }
  }, [disabledReason, prepare, token, update, workflowSessionId]);

  const cancelRun = useCallback(async (clusterId: string) => {
    const active = activeRef.current;
    if (!active || active.clusterId !== clusterId) return;
    update(clusterId, { phase: "cancelling", runId: active.runId });
    try {
      const response = await apiClient.post(`/workflows/${active.workflowId}/runs/${active.runId}/cancel`, {}, token);
      if (activeRef.current?.runId !== active.runId || sessionRef.current !== active.sessionId) return;
      if (!response.ok) throw new Error("Unable to stop cluster run");
    } catch (error) {
      if (activeRef.current?.runId === active.runId && sessionRef.current === active.sessionId) {
        update(clusterId, { phase: "cancelling", runId: active.runId, reason: error instanceof Error ? error.message : "Unable to stop cluster run; checking current status" });
      }
    }
  }, [token, update]);

  const getState = useCallback((clusterId: string): ClusterRunState => {
    if (disabledReason) return { phase: "blocked", reason: disabledReason };
    if (states[clusterId]) return states[clusterId];
    if (activeRef.current) return { phase: "blocked", reason: "Another editor execution is active." };
    return { phase: "idle" };
  }, [disabledReason, states]);

  const isExecutionActive = Object.values(states).some(({ phase }) => ["preparing", "queued", "running", "cancelling"].includes(phase));
  return { executeCluster, cancelRun, getState, isExecutionActive };
}
