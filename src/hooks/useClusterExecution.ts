import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { NodeCluster } from "@/domain/clusters/types";
import { getClusterEdgeKind } from "@/domain/clusters/edgeSemantics";
import { validateClusters } from "@/domain/clusters/validate";
import { getEditorExecutionGeneration } from "@/utils/executionGeneration";
import {
  acquireEditorExecutionLock,
  captureEditorNodeActions,
  releaseEditorExecutionLock,
  type NodeExecutionOutcome,
} from "@/services/editorNodeExecution";
import { getControlResultHandle } from "@/utils/controlResult";

export type ClusterRunPhase = "idle" | "running" | "completed" | "cancelled" | "failed" | "blocked";
export interface ClusterRunState {
  phase: ClusterRunPhase;
  reason?: string;
  currentNodeId?: string;
  completed?: number;
  eligible?: number;
  outcomes?: Readonly<Record<string, NodeExecutionOutcome>>;
}

interface Options {
  workflowSessionId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  clusters: readonly NodeCluster[];
  disabledReason?: string;
}

export interface ClusterExecutionPlan {
  memberNodeIds: readonly string[];
  executableNodeIds: readonly string[];
}

function reachableNodes(starts: readonly string[], edges: readonly Edge[], allowed: ReadonlySet<string>): Set<string> {
  const reached = new Set<string>();
  const pending = [...starts];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id || reached.has(id) || !allowed.has(id)) continue;
    reached.add(id);
    for (const edge of edges) if (edge.source === id) pending.push(edge.target);
  }
  return reached;
}

const NODE_REFERENCE = /(?:\$node\s*\[\s*["']([^"']+)["']\s*\]|\$\(\s*["']([^"']+)["']\s*\))/g;

function collectReferences(value: unknown, references: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(NODE_REFERENCE)) references.add(match[1] ?? match[2]);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, references));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectReferences(item, references));
  }
}

/** Builds and validates the complete deterministic plan before the first node executes. */
export function buildClusterExecutionPlan(
  cluster: NodeCluster,
  nodes: readonly Node[],
  edges: readonly Edge[],
): ClusterExecutionPlan {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const members = [...new Set(cluster.memberNodeIds)];
  for (const id of members) {
    if (!nodeById.has(id)) throw new Error(`Cluster member ${id} no longer exists.`);
  }
  const memberSet = new Set(members);
  const executable = members.filter((id) => {
    const definition = nodeById.get(id)?.data?.definition as { node_type?: unknown } | undefined;
    return definition?.node_type !== "sub";
  });
  const executableSet = new Set(executable);
  const dependencies = new Map(executable.map((id) => [id, new Set<string>()]));

  for (const edge of edges) {
    if (!memberSet.has(edge.source) || !memberSet.has(edge.target)) continue;
    const kind = getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target));
    if (!kind) throw new Error(`Edge ${edge.id} has unsupported execution semantics.`);
    if (kind === "main" && executableSet.has(edge.source) && executableSet.has(edge.target)) {
      const targetDefinition = nodeById.get(edge.target)?.data?.definition as { name?: unknown } | undefined;
      // A validated Loop boundary has an internal return edge. The Loop action
      // is the entry/control action, so that return edge is not a prerequisite
      // for its one manual step.
      if (targetDefinition?.name === "Loop") continue;
      dependencies.get(edge.target)?.add(edge.source);
    }
  }
  for (const id of executable) {
    const references = new Set<string>();
    collectReferences(nodeById.get(id)?.data?.values, references);
    for (const reference of references) {
      const matches = nodes.filter((candidate) => {
        const data = candidate.data as { displayName?: unknown; label?: unknown };
        return candidate.id === reference || data.displayName === reference || data.label === reference;
      });
      if (matches.length > 1) throw new Error(`Node ${id} has an ambiguous reference to ${reference}.`);
      const referencedId = matches[0]?.id;
      if (referencedId === id) throw new Error(`Node ${id} contains a self-reference.`);
      if (referencedId && executableSet.has(referencedId)) dependencies.get(id)?.add(referencedId);
    }
  }

  const memberOrder = new Map(members.map((id, index) => [id, index]));
  const remaining = new Set(executable);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => [...(dependencies.get(id) ?? [])].every((dependency) => !remaining.has(dependency)))
      .sort((left, right) => (memberOrder.get(left) ?? 0) - (memberOrder.get(right) ?? 0));
    if (ready.length === 0) {
      throw new Error(`Cluster ${cluster.title} contains a cyclic node or expression dependency.`);
    }
    for (const id of ready) {
      remaining.delete(id);
      ordered.push(id);
    }
  }
  return { memberNodeIds: members, executableNodeIds: ordered };
}

export function useClusterExecution({ workflowSessionId, nodes, edges, clusters, disabledReason }: Options) {
  const [states, setStates] = useState<Record<string, ClusterRunState>>({});
  const activeRef = useRef<{ clusterId: string; controller: AbortController } | null>(null);
  const sessionRef = useRef(workflowSessionId);
  const graphRef = useRef({ nodes, edges, clusters });
  graphRef.current = { nodes, edges, clusters };

  useEffect(() => {
    sessionRef.current = workflowSessionId;
    activeRef.current?.controller.abort();
    activeRef.current = null;
    setStates({});
    return () => activeRef.current?.controller.abort();
  }, [workflowSessionId]);

  const update = useCallback((clusterId: string, state: ClusterRunState) => {
    setStates((current) => ({ ...current, [clusterId]: state }));
  }, []);

  const executeCluster = useCallback(async (clusterId: string) => {
    // Acquire before any asynchronous work. This makes rapid repeated clicks a no-op.
    if (activeRef.current || disabledReason) return;
    const lockToken = acquireEditorExecutionLock(workflowSessionId);
    if (!lockToken) return;
    const controller = new AbortController();
    activeRef.current = { clusterId, controller };
    const generation = getEditorExecutionGeneration();
    const sessionId = workflowSessionId;
    const outcomes: Record<string, NodeExecutionOutcome> = {};
    try {
      const snapshot = graphRef.current;
      const cluster = snapshot.clusters.find(({ id }) => id === clusterId);
      if (!cluster) throw new Error("This cluster no longer exists.");
      const validation = validateClusters(snapshot.nodes, snapshot.edges, snapshot.clusters);
      const violation = validation.violations.find((item) => item.clusterId === clusterId);
      if (violation) throw new Error(violation.message);
      const plan = buildClusterExecutionPlan(cluster, snapshot.nodes, snapshot.edges);
      const actionSnapshot = captureEditorNodeActions(sessionId, plan.executableNodeIds);
      const allowedNodeIds = new Set(plan.memberNodeIds);
      const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
      const skipped = new Set<string>();
      update(clusterId, { phase: "running", completed: 0, eligible: plan.executableNodeIds.length, outcomes });
      for (const [index, nodeId] of plan.executableNodeIds.entries()) {
        if (controller.signal.aborted) {
          update(clusterId, { phase: "cancelled", reason: "Execution stopped.", completed: index, eligible: plan.executableNodeIds.length, outcomes });
          return;
        }
        if (sessionRef.current !== sessionId || getEditorExecutionGeneration() !== generation) return;
        if (skipped.has(nodeId)) {
          outcomes[nodeId] = { nodeId, status: "skipped", reason: "The node is not on the selected control path." };
          continue;
        }
        update(clusterId, { phase: "running", currentNodeId: nodeId, completed: index, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
        const outcome = await actionSnapshot.execute(nodeId, {
          signal: controller.signal,
          allowedNodeIds,
          executionGeneration: generation,
          lockToken,
        });
        if (sessionRef.current !== sessionId || getEditorExecutionGeneration() !== generation) return;
        outcomes[nodeId] = outcome;
        if (outcome.status === "cancelled") {
          update(clusterId, { phase: "cancelled", reason: outcome.reason ?? outcome.error?.message, currentNodeId: nodeId, completed: index, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
          return;
        }
        if (outcome.status === "failed") {
          update(clusterId, { phase: "failed", reason: outcome.error?.message ?? `Node ${nodeId} failed.`, currentNodeId: nodeId, completed: index, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
          return;
        }
        const definition = nodeById.get(nodeId)?.data?.definition as { name?: unknown } | undefined;
        const outgoing = snapshot.edges.filter((edge) => edge.source === nodeId && allowedNodeIds.has(edge.target));
        if (definition?.name === "If" || definition?.name === "Switch") {
          const selectedHandle = getControlResultHandle(outcome.output);
          if (!selectedHandle) throw new Error(`Node ${nodeId} returned an unsupported control result.`);
          const selectedStarts = outgoing.filter((edge) => edge.sourceHandle === selectedHandle).map((edge) => edge.target);
          const otherStarts = outgoing.filter((edge) => edge.sourceHandle !== selectedHandle).map((edge) => edge.target);
          const selectedReach = reachableNodes(selectedStarts, snapshot.edges, allowedNodeIds);
          for (const candidate of reachableNodes(otherStarts, snapshot.edges, allowedNodeIds)) {
            if (!selectedReach.has(candidate)) skipped.add(candidate);
          }
        } else if (outcome.status === "listener-started") {
          for (const candidate of reachableNodes(outgoing.map((edge) => edge.target), snapshot.edges, allowedNodeIds)) {
            skipped.add(candidate);
          }
        }
      }
      update(clusterId, { phase: "completed", completed: plan.executableNodeIds.length, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
    } catch (error) {
      update(clusterId, { phase: controller.signal.aborted ? "cancelled" : "failed", reason: error instanceof Error ? error.message : "Cluster execution failed.", outcomes });
    } finally {
      releaseEditorExecutionLock(sessionId, lockToken);
      if (activeRef.current?.controller === controller) activeRef.current = null;
    }
  }, [disabledReason, update, workflowSessionId]);

  const cancelRun = useCallback((clusterId: string) => {
    if (activeRef.current?.clusterId === clusterId) activeRef.current.controller.abort();
  }, []);

  const getState = useCallback((clusterId: string): ClusterRunState => {
    if (disabledReason) return { phase: "blocked", reason: disabledReason };
    if (states[clusterId]) return states[clusterId];
    if (activeRef.current) return { phase: "blocked", reason: "Another editor execution is active." };
    return { phase: "idle" };
  }, [disabledReason, states]);

  const isExecutionActive = useMemo(() => Object.values(states).some(({ phase }) => phase === "running"), [states]);
  return { executeCluster, cancelRun, getState, isExecutionActive };
}
