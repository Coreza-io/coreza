import { resolveClusterHierarchy } from '@/domain/clusters/hierarchy';
import { resolveNodeIdentity } from "@/utils/referenceResolution";
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
import { buildLoopRegions, findLoopFeedbackEdgeIds, reachableNodes, type LoopRegion } from "@/domain/clusters/loopRegions";
import { resolveControlResult } from "@/utils/controlResult";
import { resolveManualExecution } from "@/nodes/manualExecution";
import type { NodeConfig } from "@/nodes/schemas/nodeSchema";

export type ClusterRunPhase = "idle" | "running" | "completed" | "cancelled" | "failed" | "blocked";
export interface ClusterActiveMember {
  sessionId: string;
  clusterId: string;
  nodeId: string;
}

export interface ClusterRunState {
  phase: ClusterRunPhase;
  reason?: string;
  currentNodeId?: string;
  completed?: number;
  eligible?: number;
  ownerClusterId?: string;
  outcomes?: Readonly<Record<string, NodeExecutionOutcome>>;
}

interface Options {
  workflowSessionId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  clusters: readonly NodeCluster[];
  disabledReason?: string;
  writeLoopFeedback?: (loopId: string, edgeId: string, value: unknown) => void;
}

export interface ClusterExecutionPlan {
  memberNodeIds: readonly string[];
  executableNodeIds: readonly string[];
}

function mainEdges(edges: readonly Edge[], nodeById: ReadonlyMap<string, Node>): Edge[] {
  return edges.filter((edge) => getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)) === "main");
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
  clusters: readonly NodeCluster[] = [cluster],
): ClusterExecutionPlan {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hierarchy = resolveClusterHierarchy(clusters, nodeById.keys());
  if (hierarchy.invalidIds.has(cluster.id)) throw new Error(hierarchy.diagnostics[0]?.message ?? "Invalid cluster hierarchy.");
  const members = hierarchy.effectiveMembers.get(cluster.id) ?? [];
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
      const referencedId = resolveNodeIdentity(reference, nodes)?.id;
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

export function useClusterExecution({ workflowSessionId, nodes, edges, clusters, disabledReason, writeLoopFeedback }: Options) {
  const activeTarget = useSyncExternalStore(
    (listener) => subscribeEditorExecution(workflowSessionId, listener),
    () => getEditorExecutionTarget(workflowSessionId),
  );
  const [states, setStates] = useState<Record<string, ClusterRunState>>({});
  const activeRef = useRef<{ clusterId: string; controller: AbortController; sessionId: string; generation: number } | null>(null);
  const lastRunRef = useRef<{clusterId:string; sessionId:string; hierarchy:ReturnType<typeof resolveClusterHierarchy>; executableNodeIds:readonly string[]} | null>(null);
  const sessionRef = useRef(workflowSessionId);
  const graphRef = useRef({ nodes, edges, clusters });
  graphRef.current = { nodes, edges, clusters };

  useEffect(() => {
    sessionRef.current = workflowSessionId;
    activeRef.current?.controller.abort();
    activeRef.current = null;
    lastRunRef.current = null;
    setStates({});
    return () => {
      activeRef.current?.controller.abort();
      activeRef.current = null;
    };
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
    const generation = getEditorExecutionGeneration();
    activeRef.current = { clusterId, controller, sessionId: workflowSessionId, generation };
    const sessionId = workflowSessionId;
    const outcomes: Record<string, NodeExecutionOutcome> = {};
    let failRun: ((reason: string) => void) | undefined;
    try {
      const snapshot = graphRef.current;
      const cluster = snapshot.clusters.find(({ id }) => id === clusterId);
      if (!cluster) throw new Error("This cluster no longer exists.");
      const validation = validateClusters(snapshot.nodes, snapshot.edges, snapshot.clusters);
      const hierarchy = resolveClusterHierarchy(snapshot.clusters);
      const relevant = new Set([clusterId, ...(hierarchy.ancestors.get(clusterId) ?? []), ...(hierarchy.descendants.get(clusterId) ?? [])]);
      const violation = validation.violations.find((item) => !item.clusterId || relevant.has(item.clusterId));
      if (violation) throw new Error(violation.message);
      const plan = buildClusterExecutionPlan(cluster, snapshot.nodes, snapshot.edges, snapshot.clusters);
      lastRunRef.current = {clusterId, sessionId, hierarchy, executableNodeIds:plan.executableNodeIds};
      const actionSnapshot = captureEditorNodeActions(sessionId, plan.executableNodeIds);
      const allowedNodeIds = new Set(plan.memberNodeIds);
      const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
      const executionEdges = mainEdges(snapshot.edges, nodeById);
      const regions = buildLoopRegions(plan, snapshot.edges, nodeById, allowedNodeIds);
      const regionById = new Map(regions.map((region) => [region.loopNodeId, region]));
      const ownedBody = new Set(regions.flatMap((region) => region.bodyNodeIds));
      const feedbackEdgeIds = new Set(regions.flatMap((region) => region.feedbackEdgeIds));
      const controlReachabilityEdges = executionEdges.filter((edge) => !feedbackEdgeIds.has(edge.id));
      const skipped = new Set<string>();
      const completed = new Set<string>();
      const eligible = plan.executableNodeIds.length;
      const isCurrent = () => activeRef.current?.controller === controller &&
        sessionRef.current === sessionId && getEditorExecutionGeneration() === generation;
      const finish = (phase: "cancelled" | "failed", reason: string, nodeId?: string) => {
        for (const pendingId of plan.executableNodeIds) {
          if (!outcomes[pendingId]) outcomes[pendingId] = { nodeId: pendingId,
            status: phase === "cancelled" ? "cancelled" : "dependency-blocked", reason };
        }
        update(clusterId, { phase, reason, currentNodeId: nodeId, completed: completed.size, eligible, outcomes: { ...outcomes } });
      };
      failRun = (reason) => finish(controller.signal.aborted ? "cancelled" : "failed", reason);
      const runPlannedNode = async (nodeId: string, skippedSet: Set<string>): Promise<NodeExecutionOutcome | null> => {
        if (!isCurrent()) return null;
        if (controller.signal.aborted) { finish("cancelled", "Execution stopped.", nodeId); return null; }
        if (skippedSet.has(nodeId)) {
          const outcome: NodeExecutionOutcome = { nodeId, status: "skipped", reason: "The node is not on the selected control path." };
          outcomes[nodeId] = outcome;
          completed.add(nodeId);
          return outcome;
        }
        update(clusterId, { phase: "running", currentNodeId: nodeId, completed: completed.size, eligible, outcomes: { ...outcomes } });
        const outcome = await actionSnapshot.execute(nodeId, {
          signal: controller.signal, allowedNodeIds, executionGeneration: generation, lockToken,
        });
        if (!isCurrent()) return null;
        outcomes[nodeId] = outcome;
        if (controller.signal.aborted || outcome.status === "cancelled") {
          finish("cancelled", outcome.reason ?? "Execution stopped.", nodeId); return null;
        }
        if (outcome.status === "failed" || outcome.status === "dependency-blocked") {
          finish("failed", outcome.error?.message ?? outcome.reason ?? `Node ${nodeId} failed.`, nodeId); return null;
        }
        completed.add(nodeId);
        const definition = nodeById.get(nodeId)?.data?.definition as { name?: unknown } | undefined;
        const outgoing = executionEdges.filter((edge) => edge.source === nodeId && allowedNodeIds.has(edge.target));
        if (definition?.name === "If" || definition?.name === "Switch") {
          const decoded = resolveControlResult(outcome.selectedContinuation ?? outcome.output, new Set(outgoing.map((edge) => edge.sourceHandle ?? "")));
          if (decoded.kind === "malformed") throw new Error(`Node ${nodeId} returned an unsupported control result.`);
          const selectedReach = reachableNodes(outgoing.filter((edge) => edge.sourceHandle === decoded.handle).map((edge) => edge.target), controlReachabilityEdges, allowedNodeIds);
          for (const candidate of reachableNodes(outgoing.filter((edge) => edge.sourceHandle !== decoded.handle).map((edge) => edge.target), controlReachabilityEdges, allowedNodeIds)) {
            if (!selectedReach.has(candidate)) skippedSet.add(candidate);
          }
        } else if (outcome.status === "listener-started") {
          for (const candidate of reachableNodes(outgoing.map((edge) => edge.target), controlReachabilityEdges, allowedNodeIds)) skippedSet.add(candidate);
        }
        update(clusterId, { phase: "running", completed: completed.size, eligible, outcomes: { ...outcomes } });
        return outcome;
      };
      const runLoopRegion = async (region: LoopRegion): Promise<boolean> => {
        // Literal input gives a tighter bound; expression inputs are resolved by the node action.
        const values = nodeById.get(region.loopNodeId)?.data.values as Record<string, unknown> | undefined;
        let items: unknown = values?.inputArray;
        if (typeof items === "string") { try { items = JSON.parse(items); } catch { /* expression input */ } }
        const cap = Array.isArray(items) ? items.length + 1 : 10_000;
        for (let calls = 0; calls < cap; calls++) {
          const outcome = await runPlannedNode(region.loopNodeId, skipped);
          if (!outcome) return false;
          if (outcome.status === "skipped") return true;
          const decoded = resolveControlResult(outcome.selectedContinuation ?? outcome.output, new Set(["loop", "done"]));
          if (decoded.kind === "malformed" || !["loop", "done"].includes(decoded.handle)) throw new Error(`Loop ${region.loopNodeId} returned an unsupported control result.`);
          if (decoded.handle === "done") return true;
          const iterationSkipped = new Set(skipped);
          for (const bodyId of region.bodyNodeIds) {
            const bodyOutcome = await runPlannedNode(bodyId, iterationSkipped);
            if (!bodyOutcome) return false;
            if (bodyOutcome.status === "success" || bodyOutcome.status === "pinned") {
              for (const edge of executionEdges) {
                if (edge.source === bodyId && region.feedbackEdgeIds.includes(edge.id)) writeLoopFeedback?.(region.loopNodeId, edge.id, bodyOutcome.output);
              }
            }
          }
        }
        throw new Error(`Loop ${region.loopNodeId} exceeded its safety cap of ${cap} calls.`);
      };
      update(clusterId, { phase: "running", completed: 0, eligible, outcomes });
      for (const nodeId of plan.executableNodeIds) {
        if (ownedBody.has(nodeId)) continue;
        const region = regionById.get(nodeId);
        if (region) {
          if (!await runLoopRegion(region)) return;
          if (skipped.has(nodeId)) for (const bodyId of region.bodyNodeIds) skipped.add(bodyId);
          for (const bodyId of region.bodyNodeIds) if (!outcomes[bodyId]) {
            outcomes[bodyId] = { nodeId: bodyId, status: "skipped", reason: "The Loop body did not run." };
          }
        } else if (!await runPlannedNode(nodeId, skipped)) return;
      }
      if (!isCurrent()) return;
      update(clusterId, { phase: "completed", completed: plan.executableNodeIds.length, eligible: plan.executableNodeIds.length, outcomes: { ...outcomes } });
    } catch (error) {
      if (activeRef.current?.controller === controller && sessionRef.current === sessionId && getEditorExecutionGeneration() === generation) {
        const reason = error instanceof Error ? error.message : "Cluster execution failed.";
        if (failRun) failRun(reason);
        else update(clusterId, { phase: controller.signal.aborted ? "cancelled" : "failed", reason, outcomes });
      }
    } finally {
      releaseEditorExecutionLock(sessionId, lockToken);
      if (activeRef.current?.controller === controller) activeRef.current = null;
    }
  }, [disabledReason, update, workflowSessionId, writeLoopFeedback]);

  const cancelRun = useCallback((clusterId: string) => {
    if (activeRef.current?.clusterId !== clusterId) return;
    activeRef.current.controller.abort();
    // Keep ownership and the running phase until the action settles.
    setStates((current) => {
      const state = current[clusterId];
      return state ? { ...current, [clusterId]: { ...state, currentNodeId: undefined } } : current;
    });
  }, []);

  const getState = useCallback((clusterId: string): ClusterRunState => {
    if (disabledReason) return { phase: "blocked", reason: disabledReason };
    const latest = lastRunRef.current;
    const ownerId = latest?.sessionId === workflowSessionId ? latest.clusterId : undefined;
    if (ownerId && ownerId !== clusterId && latest) {
      const {hierarchy, executableNodeIds} = latest;
      const owner = states[ownerId];
      const related = (hierarchy.ancestors.get(clusterId) ?? []).includes(ownerId) || (hierarchy.ancestors.get(ownerId) ?? []).includes(clusterId);
      if (related && owner) {
        const members = new Set(hierarchy.effectiveMembers.get(clusterId) ?? []);
        const outcomes = Object.fromEntries(Object.entries(owner.outcomes ?? {}).filter(([id])=>members.has(id)));
        const running = activeTarget === `cluster:${ownerId}`;
        const failed = Object.values(outcomes).find(outcome=>outcome.status === 'failed');
        return {
          phase: running ? 'blocked' : failed ? 'failed' : owner.phase === 'failed' ? 'completed' : owner.phase,
          ...(running ? {ownerClusterId:ownerId, reason:`Running in ${clusters.find(c=>c.id === ownerId)?.title ?? ownerId}`} : failed ? {reason:owner.reason} : {}),
          completed:Object.keys(outcomes).length,
          eligible:executableNodeIds.filter(id=>members.has(id)).length,
          outcomes,
          currentNodeId:running && owner.currentNodeId && members.has(owner.currentNodeId) ? owner.currentNodeId : undefined,
        };
      }
    }
    if (activeTarget && activeTarget !== `cluster:${clusterId}`) return { phase: "blocked", reason: "Another editor execution is active." };
    return states[clusterId] ?? { phase: "idle" };
  }, [activeTarget, disabledReason, states, clusters, workflowSessionId]);

  const isExecutionActive = useMemo(() => Object.values(states).some(({ phase }) => phase === "running"), [states]);
  const active = activeRef.current;
  const activeState = active ? states[active.clusterId] : undefined;
  const activeClusterId = active?.clusterId;
  const activeNodeId = !disabledReason && active?.sessionId === workflowSessionId &&
    active.generation === getEditorExecutionGeneration() && !active.controller.signal.aborted &&
    activeState?.phase === "running" ? activeState.currentNodeId : undefined;
  const activeMember = useMemo<ClusterActiveMember | null>(() =>
    activeClusterId && activeNodeId ? { sessionId: workflowSessionId, clusterId: activeClusterId, nodeId: activeNodeId } : null,
  [workflowSessionId, activeClusterId, activeNodeId]);
  return { executeCluster, cancelRun, getState, isExecutionActive, activeMember };
}
