import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { useExecutionStore, useExecutionStoreNotify } from "@/contexts/ExecutionStoreContext";
import { acceptEditorExecution, getEditorExecutionGeneration } from "@/utils/executionGeneration";
import { createNotExecutedOutput, createRunPendingOutput, normalizePersistedNodeResult } from "@/utils/persistedNodeResult";

export type ClusterRunPhase = "idle" | "preparing" | "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed" | "blocked";
export interface ClusterRunState {
  phase: ClusterRunPhase;
  runId?: string;
  reason?: string;
  outputWarning?: string;
  canRetryOutput?: boolean;
}

interface PreparedCluster {
  workflowId: string;
  revision: number;
  memberNodeIds: readonly string[];
}

interface Options {
  token?: string;
  workflowSessionId: string;
  prepare: (clusterId: string) => Promise<PreparedCluster | null>;
  currentNodeIds: ReadonlySet<string>;
  disabledReason?: string;
}

interface ActiveRunDescriptor {
  workflowId: string;
  workflowSessionId: string;
  runId: string;
  clusterId: string;
  sourceRevision: number;
  memberNodeIds: readonly string[];
  executionGeneration: number;
}

interface RunStatusResponse {
  run?: {
    id?: string;
    workflow_id?: string;
    status?: string;
    error_message?: string | null;
    result?: unknown;
    source_workflow_revision?: number;
    scope_cluster_id?: string | null;
    scope_snapshot?: { memberNodeIds?: unknown };
  };
}

const terminalStatuses = new Set(["success", "succeeded", "completed", "failed", "cancelled"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function descriptorMatches(left: ActiveRunDescriptor | null, right: ActiveRunDescriptor): boolean {
  return Boolean(left && left.runId === right.runId && left.workflowSessionId === right.workflowSessionId &&
    left.clusterId === right.clusterId && left.sourceRevision === right.sourceRevision &&
    left.executionGeneration === right.executionGeneration);
}

function validateResponse(payload: RunStatusResponse, descriptor: ActiveRunDescriptor): boolean {
  const run = payload.run;
  const members = run?.scope_snapshot?.memberNodeIds;
  return Boolean(run && run.id === descriptor.runId && run.workflow_id === descriptor.workflowId &&
    run.scope_cluster_id === descriptor.clusterId && run.source_workflow_revision === descriptor.sourceRevision &&
    Array.isArray(members) && members.length === descriptor.memberNodeIds.length &&
    members.every((nodeId, index) => nodeId === descriptor.memberNodeIds[index]));
}

export function useClusterExecution({ token, workflowSessionId, prepare, currentNodeIds, disabledReason }: Options) {
  const [states, setStates] = useState<Record<string, ClusterRunState>>({});
  const activeRef = useRef<ActiveRunDescriptor | null>(null);
  const terminalRef = useRef<ActiveRunDescriptor | null>(null);
  const submittingRef = useRef(false);
  const sessionRef = useRef(workflowSessionId);
  const executionStore = useExecutionStore();
  const notifyStoreUpdate = useExecutionStoreNotify();
  const update = useCallback((clusterId: string, state: ClusterRunState) =>
    setStates((current) => ({ ...current, [clusterId]: state })), []);

  useEffect(() => {
    sessionRef.current = workflowSessionId;
    activeRef.current = null;
    terminalRef.current = null;
    submittingRef.current = false;
    setStates({});
  }, [workflowSessionId]);

  const isCurrent = useCallback((descriptor: ActiveRunDescriptor) =>
    descriptorMatches(activeRef.current, descriptor) && sessionRef.current === descriptor.workflowSessionId &&
    getEditorExecutionGeneration() === descriptor.executionGeneration, []);

  const readRun = useCallback(async (descriptor: ActiveRunDescriptor, signal?: AbortSignal): Promise<RunStatusResponse> => {
    const response = await apiClient.request(`/workflows/${descriptor.workflowId}/runs/${descriptor.runId}/status`, {
      method: "GET",
      token,
      signal,
    });
    if (!response.ok) throw new Error("Unable to load cluster output");
    return response.json() as Promise<RunStatusResponse>;
  }, [token]);

  const hydrateTerminal = useCallback((descriptor: ActiveRunDescriptor, payload: RunStatusResponse): string | undefined => {
    if (!isCurrent(descriptor) || !validateResponse(payload, descriptor)) {
      throw new Error("The run response no longer matches this editor execution");
    }
    const result = payload.run?.result;
    const nodeResults = isRecord(result) && isRecord(result.nodeResults) ? result.nodeResults : null;
    for (const nodeId of descriptor.memberNodeIds) {
      if (!currentNodeIds.has(nodeId)) continue;
      const hasResult = nodeResults !== null && Object.prototype.hasOwnProperty.call(nodeResults, nodeId);
      executionStore.setNodeData(nodeId, {
        output: hasResult
          ? normalizePersistedNodeResult(nodeResults[nodeId])
          : createNotExecutedOutput(descriptor.runId, payload.run?.status === "cancelled"),
      });
    }
    notifyStoreUpdate();
    return nodeResults ? undefined : "The run completed, but its node output is unavailable.";
  }, [currentNodeIds, executionStore, isCurrent, notifyStoreUpdate]);

  useEffect(() => {
    const descriptor = activeRef.current;
    if (!descriptor || !["queued", "running", "cancelling"].includes(states[descriptor.clusterId]?.phase)) return;
    const controller = new AbortController();
    let stopped = false;
    const poll = async () => {
      while (!stopped && isCurrent(descriptor)) {
        try {
          const payload = await readRun(descriptor, controller.signal);
          if (!isCurrent(descriptor)) return;
          if (!validateResponse(payload, descriptor)) throw new Error("The run response no longer matches this editor execution");
          const status = payload.run?.status?.toLowerCase();
          if (!status) throw new Error("Run status response was incomplete");
          if (terminalStatuses.has(status)) {
            let outputWarning: string | undefined;
            try {
              outputWarning = hydrateTerminal(descriptor, payload);
            } catch (error) {
              outputWarning = error instanceof Error ? error.message : "Unable to load cluster output";
            }
            if (!isCurrent(descriptor)) return;
            const phase: ClusterRunPhase = status === "failed" || status === "cancelled" ? status : "completed";
            update(descriptor.clusterId, {
              phase,
              runId: descriptor.runId,
              reason: phase === "failed" || phase === "cancelled" ? payload.run?.error_message ?? undefined : undefined,
              outputWarning,
              canRetryOutput: Boolean(outputWarning),
            });
            terminalRef.current = descriptor;
            activeRef.current = null;
            return;
          }
          update(descriptor.clusterId, { phase: status === "queued" ? "queued" : status === "cancelling" ? "cancelling" : "running", runId: descriptor.runId });
        } catch (error) {
          if (controller.signal.aborted || !isCurrent(descriptor)) return;
          update(descriptor.clusterId, {
            ...states[descriptor.clusterId],
            runId: descriptor.runId,
            outputWarning: error instanceof Error ? error.message : "Unable to load cluster output",
          });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); };
  }, [hydrateTerminal, isCurrent, readRun, states, update]);

  const executeCluster = useCallback(async (clusterId: string) => {
    if (submittingRef.current || activeRef.current || disabledReason) return;
    const requestSessionId = workflowSessionId;
    submittingRef.current = true;
    update(clusterId, { phase: "preparing" });
    try {
      const saved = await prepare(clusterId);
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
      const descriptor: ActiveRunDescriptor = Object.freeze({
        workflowId: saved.workflowId,
        workflowSessionId: requestSessionId,
        runId: payload.run_id,
        clusterId,
        sourceRevision: saved.revision,
        memberNodeIds: Object.freeze([...saved.memberNodeIds]),
        executionGeneration: acceptEditorExecution(),
      });
      activeRef.current = descriptor;
      terminalRef.current = null;
      for (const nodeId of descriptor.memberNodeIds) {
        if (currentNodeIds.has(nodeId)) executionStore.setNodeData(nodeId, { output: createRunPendingOutput(descriptor.runId) });
      }
      notifyStoreUpdate();
      update(clusterId, { phase: payload.status === "running" ? "running" : "queued", runId: descriptor.runId });
    } catch (error) {
      if (sessionRef.current === requestSessionId) update(clusterId, { phase: "failed", reason: error instanceof Error ? error.message : "Cluster execution could not be started" });
    } finally {
      submittingRef.current = false;
    }
  }, [currentNodeIds, disabledReason, executionStore, notifyStoreUpdate, prepare, token, update, workflowSessionId]);

  const retryOutputHydration = useCallback(async (clusterId: string) => {
    const descriptor = terminalRef.current;
    if (!descriptor || descriptor.clusterId !== clusterId || getEditorExecutionGeneration() !== descriptor.executionGeneration) return;
    activeRef.current = descriptor;
    try {
      const payload = await readRun(descriptor);
      const warning = hydrateTerminal(descriptor, payload);
      const current = states[clusterId];
      update(clusterId, { ...current, outputWarning: warning, canRetryOutput: Boolean(warning) });
    } catch (error) {
      const current = states[clusterId];
      update(clusterId, { ...current, outputWarning: error instanceof Error ? error.message : "Unable to load cluster output", canRetryOutput: true });
    } finally {
      if (descriptorMatches(activeRef.current, descriptor)) activeRef.current = null;
    }
  }, [hydrateTerminal, readRun, states, update]);

  const cancelRun = useCallback(async (clusterId: string) => {
    const active = activeRef.current;
    if (!active || active.clusterId !== clusterId) return;
    update(clusterId, { phase: "cancelling", runId: active.runId });
    try {
      const response = await apiClient.post(`/workflows/${active.workflowId}/runs/${active.runId}/cancel`, {}, token);
      if (!descriptorMatches(activeRef.current, active)) return;
      if (!response.ok) throw new Error("Unable to stop cluster run");
    } catch (error) {
      if (descriptorMatches(activeRef.current, active)) update(clusterId, { phase: "cancelling", runId: active.runId, reason: error instanceof Error ? error.message : "Unable to stop cluster run; checking current status" });
    }
  }, [token, update]);

  const getState = useCallback((clusterId: string): ClusterRunState => {
    if (disabledReason) return { phase: "blocked", reason: disabledReason };
    if (states[clusterId]) return states[clusterId];
    if (activeRef.current) return { phase: "blocked", reason: "Another editor execution is active." };
    return { phase: "idle" };
  }, [disabledReason, states]);

  const isExecutionActive = Object.values(states).some(({ phase }) => ["preparing", "queued", "running", "cancelling"].includes(phase));
  return { executeCluster, cancelRun, retryOutputHydration, getState, isExecutionActive };
}
