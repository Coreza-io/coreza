import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { useExecutionStore, useExecutionStoreNotify } from "@/contexts/ExecutionStoreContext";
import { acceptEditorExecution, getEditorExecutionGeneration } from "@/utils/executionGeneration";
import { createRunPendingOutput } from "@/utils/persistedNodeResult";
import { resolveClusterRunResult } from "@/utils/clusterRunResult";

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
const RESULT_FINALIZATION_RETRIES = 5;
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
  const terminalRef = useRef(new Map<string, ActiveRunDescriptor>());
  const submissionRef = useRef<symbol | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const pollDelayRef = useRef<number | null>(null);
  const retryRef = useRef<{ descriptor: ActiveRunDescriptor; controller: AbortController } | null>(null);
  const sessionRef = useRef(workflowSessionId);
  const executionStore = useExecutionStore();
  const notifyStoreUpdate = useExecutionStoreNotify();
  const update = useCallback((clusterId: string, state: ClusterRunState) =>
    setStates((current) => ({ ...current, [clusterId]: state })), []);

  useEffect(() => {
    sessionRef.current = workflowSessionId;
    pollControllerRef.current?.abort();
    if (pollDelayRef.current !== null) window.clearTimeout(pollDelayRef.current);
    retryRef.current?.controller.abort();
    pollControllerRef.current = null;
    pollDelayRef.current = null;
    retryRef.current = null;
    activeRef.current = null;
    terminalRef.current.clear();
    submissionRef.current = null;
    setStates({});
    return () => {
      pollControllerRef.current?.abort();
      retryRef.current?.controller.abort();
      if (pollDelayRef.current !== null) window.clearTimeout(pollDelayRef.current);
    };
  }, [workflowSessionId]);

  const isCurrent = useCallback((descriptor: ActiveRunDescriptor) =>
    descriptorMatches(activeRef.current, descriptor) && sessionRef.current === descriptor.workflowSessionId &&
    getEditorExecutionGeneration() === descriptor.executionGeneration, []);

  const releaseDescriptor = useCallback((descriptor: ActiveRunDescriptor) => {
    if (!descriptorMatches(activeRef.current, descriptor)) return;
    activeRef.current = null;
    pollControllerRef.current?.abort();
    pollControllerRef.current = null;
    if (pollDelayRef.current !== null) {
      window.clearTimeout(pollDelayRef.current);
      pollDelayRef.current = null;
    }
    setStates((current) => ({
      ...current,
      [descriptor.clusterId]: { phase: "idle" },
    }));
  }, []);

  const readRun = useCallback(async (descriptor: ActiveRunDescriptor, signal?: AbortSignal): Promise<RunStatusResponse> => {
    const response = await apiClient.request(`/workflows/${descriptor.workflowId}/runs/${descriptor.runId}/status`, {
      method: "GET",
      token,
      signal,
    });
    if (!response.ok) throw new Error("Unable to load cluster output");
    return response.json() as Promise<RunStatusResponse>;
  }, [token]);

  const descriptorSessionIsCurrent = useCallback((descriptor: ActiveRunDescriptor) =>
    sessionRef.current === descriptor.workflowSessionId &&
    getEditorExecutionGeneration() === descriptor.executionGeneration, []);

  const hydrateTerminal = useCallback((descriptor: ActiveRunDescriptor, payload: RunStatusResponse): { finalized: boolean; warning?: string } => {
    if (!descriptorSessionIsCurrent(descriptor) || !validateResponse(payload, descriptor)) {
      throw new Error("The run response no longer matches this editor execution");
    }
    const resolution = resolveClusterRunResult(payload.run?.result, descriptor.memberNodeIds, descriptor.runId);
    if (!resolution.finalized) return resolution;
    let didHydrate = false;
    for (const [nodeId, output] of resolution.outputs) {
      if (!currentNodeIds.has(nodeId)) continue;
      executionStore.setNodeData(nodeId, { output });
      didHydrate = true;
    }
    if (didHydrate) notifyStoreUpdate();
    return resolution;
  }, [currentNodeIds, descriptorSessionIsCurrent, executionStore, notifyStoreUpdate]);

  const startPolling = useCallback((descriptor: ActiveRunDescriptor) => {
    pollControllerRef.current?.abort();
    if (pollDelayRef.current !== null) window.clearTimeout(pollDelayRef.current);
    const controller = new AbortController();
    pollControllerRef.current = controller;
    const waitForNextPoll = () => new Promise<void>((resolve) => {
      pollDelayRef.current = window.setTimeout(() => {
        pollDelayRef.current = null;
        resolve();
      }, 1_000);
    });
    const poll = async () => {
      let finalizationRetries = 0;
      while (!controller.signal.aborted && isCurrent(descriptor)) {
        try {
          const payload = await readRun(descriptor, controller.signal);
          if (!isCurrent(descriptor)) {
            releaseDescriptor(descriptor);
            return;
          }
          if (!validateResponse(payload, descriptor)) throw new Error("The run response no longer matches this editor execution");
          const status = payload.run?.status?.toLowerCase();
          if (!status) throw new Error("Run status response was incomplete");
          if (terminalStatuses.has(status)) {
            let outputWarning: string | undefined;
            try {
              const hydration = hydrateTerminal(descriptor, payload);
              if (!hydration.finalized && finalizationRetries < RESULT_FINALIZATION_RETRIES) {
                finalizationRetries += 1;
                await waitForNextPoll();
                continue;
              }
              outputWarning = hydration.finalized
                ? hydration.warning
                : "The run finished before its output was finalized. Retry output to check again.";
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
            terminalRef.current.set(descriptor.clusterId, descriptor);
            activeRef.current = null;
            pollControllerRef.current = null;
            return;
          }
          update(descriptor.clusterId, { phase: status === "queued" ? "queued" : status === "cancelling" ? "cancelling" : "running", runId: descriptor.runId });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (!isCurrent(descriptor)) {
            releaseDescriptor(descriptor);
            return;
          }
          setStates((current) => ({
            ...current,
            [descriptor.clusterId]: {
              ...current[descriptor.clusterId],
              runId: descriptor.runId,
              phase: current[descriptor.clusterId]?.phase ?? "running",
              outputWarning: error instanceof Error ? error.message : "Unable to load cluster output",
            },
          }));
        }
        await waitForNextPoll();
      }
      if (!controller.signal.aborted) releaseDescriptor(descriptor);
    };
    void poll();
  }, [hydrateTerminal, isCurrent, readRun, releaseDescriptor, update]);

  const executeCluster = useCallback(async (clusterId: string) => {
    if (submissionRef.current || activeRef.current || disabledReason) return;
    const requestSessionId = workflowSessionId;
    const submissionToken = Symbol(clusterId);
    submissionRef.current = submissionToken;
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
      terminalRef.current.delete(clusterId);
      for (const nodeId of descriptor.memberNodeIds) {
        if (currentNodeIds.has(nodeId)) executionStore.setNodeData(nodeId, { output: createRunPendingOutput(descriptor.runId) });
      }
      notifyStoreUpdate();
      update(clusterId, { phase: payload.status === "running" ? "running" : "queued", runId: descriptor.runId });
      startPolling(descriptor);
    } catch (error) {
      if (sessionRef.current === requestSessionId) update(clusterId, { phase: "failed", reason: error instanceof Error ? error.message : "Cluster execution could not be started" });
    } finally {
      if (submissionRef.current === submissionToken) submissionRef.current = null;
    }
  }, [currentNodeIds, disabledReason, executionStore, notifyStoreUpdate, prepare, startPolling, token, update, workflowSessionId]);

  const retryOutputHydration = useCallback(async (clusterId: string) => {
    const descriptor = terminalRef.current.get(clusterId);
    if (!descriptor || descriptor.clusterId !== clusterId || !descriptorSessionIsCurrent(descriptor) || retryRef.current) return;
    const controller = new AbortController();
    retryRef.current = { descriptor, controller };
    try {
      const payload = await readRun(descriptor, controller.signal);
      if (retryRef.current?.controller !== controller || !descriptorSessionIsCurrent(descriptor)) return;
      const hydration = hydrateTerminal(descriptor, payload);
      const warning = hydration.finalized
        ? hydration.warning
        : "The run output is not finalized yet. Retry output to check again.";
      setStates((current) => ({ ...current, [clusterId]: { ...current[clusterId], outputWarning: warning, canRetryOutput: Boolean(warning) } }));
    } catch (error) {
      if (controller.signal.aborted || retryRef.current?.controller !== controller || !descriptorSessionIsCurrent(descriptor)) return;
      setStates((current) => ({ ...current, [clusterId]: { ...current[clusterId], outputWarning: error instanceof Error ? error.message : "Unable to load cluster output", canRetryOutput: true } }));
    } finally {
      if (retryRef.current?.controller === controller) retryRef.current = null;
    }
  }, [descriptorSessionIsCurrent, hydrateTerminal, readRun]);

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
