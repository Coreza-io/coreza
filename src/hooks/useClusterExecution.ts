import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  getEditorExecutionTarget,
  subscribeEditorExecution,
} from "@/services/editorNodeExecution";
import { resolveControlResult } from "@/utils/controlResult";
import { resolveManualExecution } from "@/nodes/manualExecution";
import type { NodeConfig } from "@/nodes/schemas/nodeSchema";

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

function mainEdges(edges: readonly Edge[], nodeById: ReadonlyMap<string, Node>): Edge[] {
  return edges.filter((edge) => getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)) === "main");
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

function findLoopFeedbackEdgeIds(
  executableNodeIds: readonly string[],
  edges: readonly Edge[],
  nodeById: ReadonlyMap<string, Node>,
  allowed: ReadonlySet<string>,
): Set<string> {
  const feedback = new Set<string>();
  for (const loopId of executableNodeIds) {
    const definition = nodeById.get(loopId)?.data?.definition as { name?: unknown } | undefined;
    if (definition?.name !== "Loop") continue;
    const bodyStarts = edges
      .filter((edge) => edge.source === loopId && edge.sourceHandle === "loop")
      .map((edge) => edge.target);
    const bodyReach = reachableNodes(bodyStarts, edges, allowed);
    for (const edge of edges) {
      if (edge.target === loopId && bodyReach.has(edge.source)) feedback.add(edge.id);
    }
  }
  return feedback;
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
    const definition = nodeById.get(id)?.data?.definition as NodeConfig | undefined;
    return definition ? resolveManualExecution(definition).available : false;
  });
  const executableSet = new Set(executable);
  const dependencies = new Map(executable.map((id) => [id, new Set<string>()]));
  const internalMainEdges = mainEdges(
    edges.filter((edge) => memberSet.has(edge.source) && memberSet.has(edge.target)),
    nodeById,
  );
  const loopFeedbackEdges = findLoopFeedbackEdgeIds(executable, internalMainEdges, nodeById, memberSet);

  for (const edge of edges) {
    if (!memberSet.has(edge.source) || !memberSet.has(edge.target)) continue;
    const kind = getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target));
    if (!kind) throw new Error(`Edge ${edge.id} has unsupported execution semantics.`);
    if (kind === "main" && executableSet.has(edge.source) && executableSet.has(edge.target)) {
      // Only the validated body return is feedback. Ordinary prerequisites of
      // a Loop remain dependencies and must execute before the Loop action.
      if (loopFeedbackEdges.has(edge.id)) continue;
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
  const activeTarget = useSyncExternalStore(
    (listener) => subscribeEditorExecution(workflowSessionId, listener),
    () => getEditorExecutionTarget(workflowSessionId),
  );
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
    const lockToken = acquireEditorExecutionLock(workflowSessionId, { kind: "cluster", id: clusterId });
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
      const executionEdges = mainEdges(snapshot.edges, nodeById);
      const feedbackEdgeIds = findLoopFeedbackEdgeIds(plan.executableNodeIds, executionEdges, nodeById, allowedNodeIds);
      const controlReachabilityEdges = executionEdges.filter((edge) => !feedbackEdgeIds.has(edge.id));
      const skipped = new Set<string>();
      update(clusterId, { phase: "running", completed: 0, eligible: plan.executableNodeIds.length, outcomes });
      for (const [index, nodeId] of plan.executableNodeIds.entries()) {
        if (controller.signal.aborted) {
          for (const pendingId of plan.executableNodeIds.slice(index)) {
            outcomes[pendingId] = { nodeId: pendingId, status: "cancelled", reason: "Execution was stopped before this node ran." };
          }
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
          for (const pendingId of plan.executableNodeIds.slice(index + 1)) {
            outcomes[pendingId] = { nodeId: pendingId, status: "cancelled", reason: "Execution was stopped before this node ran." };
          }
          update(clusterId, { phase: "cancelled", reason: outcome.reason ?? outcome.error?.message, currentNodeId: nodeId, completed: index, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
          return;
        }
        if (outcome.status === "failed") {
          for (const pendingId of plan.executableNodeIds.slice(index + 1)) {
            outcomes[pendingId] = { nodeId: pendingId, status: "dependency-blocked", reason: `Execution stopped after ${nodeId} failed.` };
          }
          update(clusterId, { phase: "failed", reason: outcome.error?.message ?? `Node ${nodeId} failed.`, currentNodeId: nodeId, completed: index, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
          return;
        }
        const definition = nodeById.get(nodeId)?.data?.definition as { name?: unknown } | undefined;
        const outgoing = executionEdges.filter((edge) => edge.source === nodeId && allowedNodeIds.has(edge.target));
        if (definition?.name === "If" || definition?.name === "Switch" || definition?.name === "Loop") {
          const decoded = outcome.selectedContinuation
            ? resolveControlResult(outcome.selectedContinuation, new Set(outgoing.map((edge) => edge.sourceHandle ?? "")))
            : resolveControlResult(outcome.output, new Set(outgoing.map((edge) => edge.sourceHandle ?? "")));
          if (decoded.kind === "malformed") throw new Error(`Node ${nodeId} returned an unsupported control result.`);
          const selectedHandle = decoded.handle;
          const selectedStarts = outgoing.filter((edge) => edge.sourceHandle === selectedHandle).map((edge) => edge.target);
          const otherStarts = outgoing.filter((edge) => edge.sourceHandle !== selectedHandle).map((edge) => edge.target);
          const selectedReach = reachableNodes(selectedStarts, controlReachabilityEdges, allowedNodeIds);
          for (const candidate of reachableNodes(otherStarts, controlReachabilityEdges, allowedNodeIds)) {
            if (!selectedReach.has(candidate)) skipped.add(candidate);
          }
        } else if (outcome.status === "listener-started") {
          for (const candidate of reachableNodes(outgoing.map((edge) => edge.target), controlReachabilityEdges, allowedNodeIds)) {
            skipped.add(candidate);
          }
        }
      }
      update(clusterId, { phase: "completed", completed: plan.executableNodeIds.length, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
    } catch (error) {
      if (activeRef.current?.controller === controller && sessionRef.current === sessionId && getEditorExecutionGeneration() === generation) {
        update(clusterId, { phase: controller.signal.aborted ? "cancelled" : "failed", reason: error instanceof Error ? error.message : "Cluster execution failed.", outcomes });
      }
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
    if (activeTarget && activeTarget !== `cluster:${clusterId}`) return { phase: "blocked", reason: "Another editor execution is active." };
    return { phase: "idle" };
  }, [activeTarget, disabledReason, states]);

  const isExecutionActive = useMemo(() => Object.values(states).some(({ phase }) => phase === "running"), [states]);
  return { executeCluster, cancelRun, getState, isExecutionActive };
}
