import { requiredWarmupBars } from "../../engine/indicatorStateManager";
import { clampWindowSize } from "../../engine/rollingWindowHelpers";
import type { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { validateTimeframeRatio } from "../../utils/timeframe";
import type { DiscoveredWarmupNode } from "../../nodes/executors/InitializeIndicatorsExecutor";

export interface ConsolidatorWarmupRequirement {
  requiredSourceBars: number;
  requiresWorkflowReplay: boolean;
}

function collectReachableIds(
  startIds: readonly string[],
  outgoing: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const queue = [...startIds];
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) queue.push(target);
  }
  return reachable;
}

function requiredBars(node: DiscoveredWarmupNode): number {
  return node.type === "rollingwindow"
    ? clampWindowSize(node.params.size)
    : requiredWarmupBars(node.type, node.params);
}

export function resolveConsolidatorWarmup(
  backtestNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  warmupNodes: readonly DiscoveredWarmupNode[],
): ConsolidatorWarmupRequirement {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const strategyIds = collectReachableIds(
    outgoing.get(backtestNodeId) ?? [],
    outgoing,
  );
  let requiredSourceBars = 0;
  let requiresWorkflowReplay = false;

  for (const consolidator of nodes) {
    if (consolidator.name !== "Consolidator" || !strategyIds.has(consolidator.id)) continue;
    const downstreamIds = collectReachableIds(
      outgoing.get(consolidator.id) ?? [],
      outgoing,
    );
    const downstreamRequiredBars = warmupNodes
      .filter((candidate) => downstreamIds.has(candidate.nodeId))
      .reduce((maximum, candidate) => Math.max(maximum, requiredBars(candidate)), 0);
    if (downstreamRequiredBars === 0) continue;

    const values = consolidator.values ?? consolidator.data?.values ?? {};
    const { ratio } = validateTimeframeRatio(
      values.source_timeframe,
      values.target_timeframe,
    );
    requiredSourceBars = Math.max(
      requiredSourceBars,
      downstreamRequiredBars * ratio + ratio,
    );
    requiresWorkflowReplay = true;
  }

  return { requiredSourceBars, requiresWorkflowReplay };
}
