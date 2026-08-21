import { requiredWarmupBars } from "../../engine/indicatorStateManager";
import { clampWindowSize } from "../../engine/rollingWindowHelpers";
import type { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { validateTimeframeRatio } from "../../utils/timeframe";
import type { DiscoveredWarmupNode } from "../../nodes/executors/InitializeIndicatorsExecutor";

export interface ConsolidatorWarmupRequirement {
  requiredSourceBars: number;
  requiresWorkflowReplay: boolean;
}

function requiredBars(node: DiscoveredWarmupNode): number {
  return node.type === "rollingwindow"
    ? clampWindowSize(node.params.size)
    : requiredWarmupBars(node.type, node.params);
}

/** Resolves each warm-up path backwards, converting bars at consolidator boundaries. */
export function resolveConsolidatorWarmup(
  backtestNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  warmupNodes: readonly DiscoveredWarmupNode[],
): ConsolidatorWarmupRequirement {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }

  let requiredSourceBars = 0;
  let requiresWorkflowReplay = false;
  const visit = (
    nodeId: string,
    downstreamBars: number,
    hasConsolidator: boolean,
    path: ReadonlySet<string>,
  ): void => {
    if (path.has(nodeId)) return;
    const nextPath = new Set(path).add(nodeId);
    const node = nodeById.get(nodeId);
    let sourceBars = downstreamBars;
    let pathHasConsolidator = hasConsolidator;
    if (node?.name === "Consolidator") {
      const values = node.values ?? node.data?.values ?? {};
      const { ratio } = validateTimeframeRatio(
        values.source_timeframe,
        values.target_timeframe,
      );
      sourceBars = sourceBars * ratio + ratio;
      pathHasConsolidator = true;
    }

    if (nodeId === backtestNodeId) {
      if (pathHasConsolidator) {
        requiredSourceBars = Math.max(requiredSourceBars, sourceBars);
        requiresWorkflowReplay = true;
      }
      return;
    }
    for (const sourceId of incoming.get(nodeId) ?? []) {
      visit(sourceId, sourceBars, pathHasConsolidator, nextPath);
    }
  };

  for (const warmupNode of warmupNodes) {
    visit(warmupNode.nodeId, requiredBars(warmupNode), false, new Set());
  }
  return { requiredSourceBars, requiresWorkflowReplay };
}
