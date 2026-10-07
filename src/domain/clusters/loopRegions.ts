import type { Edge, Node } from "@xyflow/react";
import type { ClusterExecutionPlan } from "@/hooks/useClusterExecution";
import { getClusterEdgeKind } from "./edgeSemantics";

export interface LoopRegion {
  loopNodeId: string;
  feedbackEdgeIds: string[];
  bodyNodeIds: string[];
  doneStartNodeIds: string[];
}

export function reachableNodes(starts: readonly string[], edges: readonly Edge[], allowed: ReadonlySet<string>): Set<string> {
  const reached = new Set<string>();
  const pending = [...starts];
  while (pending.length) {
    const id = pending.shift()!;
    if (reached.has(id) || !allowed.has(id)) continue;
    reached.add(id);
    for (const edge of edges) if (edge.source === id) pending.push(edge.target);
  }
  return reached;
}

export function findLoopFeedbackEdgeIds(ids: readonly string[], edges: readonly Edge[], nodeById: ReadonlyMap<string, Node>, allowed: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    if ((nodeById.get(id)?.data.definition as { name?: string })?.name !== "Loop") continue;
    const starts = edges.filter((edge) => edge.source === id && edge.sourceHandle === "loop").map((edge) => edge.target);
    // Stop at the Loop itself, so its done side cannot become part of its body.
    const bodyAllowed = new Set([...allowed].filter((candidate) => candidate !== id));
    const reach = reachableNodes(starts, edges, bodyAllowed);
    for (const edge of edges) if (edge.target === id && reach.has(edge.source)) result.add(edge.id);
  }
  return result;
}

/** Derives iteration ownership before any node action runs. */
export function buildLoopRegions(plan: ClusterExecutionPlan, edges: readonly Edge[], nodeById: ReadonlyMap<string, Node>, allowedNodeIds: ReadonlySet<string>): LoopRegion[] {
  const internal = edges.filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target)
    && getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)) === "main");
  const feedback = findLoopFeedbackEdgeIds(plan.executableNodeIds, internal, nodeById, allowedNodeIds);
  const forward = internal.filter((edge) => !feedback.has(edge.id));
  const reverse = forward.map((edge) => ({ ...edge, source: edge.target, target: edge.source }));
  const regions: LoopRegion[] = [];
  for (const id of plan.executableNodeIds) {
    if ((nodeById.get(id)?.data.definition as { name?: string })?.name !== "Loop") continue;
    const starts = internal.filter((edge) => edge.source === id && edge.sourceHandle === "loop").map((edge) => edge.target);
    const returns = internal.filter((edge) => edge.target === id && feedback.has(edge.id));
    if (starts.length && !returns.length) throw new Error(`Loop ${id} has a loop branch without a feedback connection.`);
    const bodyAllowed = new Set([...allowedNodeIds].filter((candidate) => candidate !== id));
    const reach = reachableNodes(starts, forward, bodyAllowed);
    const ancestors = reachableNodes(returns.map((edge) => edge.source), reverse, bodyAllowed);
    const body = new Set([...reach].filter((candidate) => ancestors.has(candidate)));
    const doneStartNodeIds = internal.filter((edge) => edge.source === id && edge.sourceHandle === "done").map((edge) => edge.target);
    const done = reachableNodes(doneStartNodeIds, forward, bodyAllowed);
    if ([...body].some((candidate) => done.has(candidate))) throw new Error(`Loop ${id} has a body node on its done side.`);
    regions.push({ loopNodeId: id, feedbackEdgeIds: returns.map((edge) => edge.id), bodyNodeIds: plan.executableNodeIds.filter((candidate) => body.has(candidate)), doneStartNodeIds });
  }
  for (const left of regions) for (const right of regions) {
    if (left === right) continue;
    if (left.bodyNodeIds.includes(right.loopNodeId) || left.bodyNodeIds.some((id) => right.bodyNodeIds.includes(id))) {
      throw new Error("Overlapping or nested Loop bodies are unsupported.");
    }
  }
  return regions;
}
