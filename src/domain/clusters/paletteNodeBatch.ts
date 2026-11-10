import { allocateNodeName } from "@/domain/nodeNaming";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { NodeConfig } from "@/nodes/manifest";

export const BACKTEST_INIT_NODE_TYPE = "BacktestInit";
export const ON_BAR_NODE_TYPE = "OnBar";
export const ON_BAR_COMPANION_OFFSET_X = 450;

export interface PaletteNodeBatch {
  primaryNodeId: string;
  nodes: Node[];
  edges: Edge[];
}

const allocateId = (baseId: string, reservedIds: Set<string>): string => {
  let candidate = baseId;
  let suffix = 1;
  while (reservedIds.has(candidate)) candidate = `${baseId}${suffix++}`;
  reservedIds.add(candidate);
  return candidate;
};

export function createPaletteNodeBatch(args: {
  nodeType: string;
  definition: NodeConfig;
  onBarDefinition?: NodeConfig;
  position: XYPosition;
  workflowSessionId: string;
  existingNodes: readonly Node[];
  existingEdges: readonly Edge[];
  onRemoveEdge: (edgeId: string) => void;
}): PaletteNodeBatch {
  const reservations = new Set<string>();
  const allocate = (base: string) => {
    const result = allocateNodeName(base, args.existingNodes, undefined, reservations);
    if (result.ok === false) throw new Error(result.message);
    reservations.add(result.name);
    return result.name;
  };
  // Palette labels may contain punctuation that is not valid in instance names.
  // Keep the registered type intact; only normalize the initial public name.
  const initialName = args.nodeType.replace(/[^a-zA-Z0-9_\-\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Node";
  const primaryNodeId = allocate(initialName);
  const nodes: Node[] = [{
    id: primaryNodeId,
    type: args.nodeType,
    position: args.position,
    data: {
      displayName: primaryNodeId,
      label: args.definition.name || `${args.nodeType} node`,
      definition: args.definition,
      workflowSessionId: args.workflowSessionId,
    },
  }];
  const edges: Edge[] = [];

  const needsOnBar = args.nodeType === BACKTEST_INIT_NODE_TYPE
    && !args.existingNodes.some(({ type }) => type === ON_BAR_NODE_TYPE)
    && args.onBarDefinition;
  if (!needsOnBar) return { primaryNodeId, nodes, edges };

  const onBarNodeId = allocate(ON_BAR_NODE_TYPE);
  nodes.push({
    id: onBarNodeId,
    type: ON_BAR_NODE_TYPE,
    position: { x: args.position.x + ON_BAR_COMPANION_OFFSET_X, y: args.position.y },
    data: {
      displayName: onBarNodeId,
      label: args.onBarDefinition?.name || "OnBar node",
      definition: args.onBarDefinition,
      workflowSessionId: args.workflowSessionId,
    },
  });

  const edgeIds = new Set(args.existingEdges.map(({ id }) => id));
  const edgeId = allocateId(`edge_${primaryNodeId}_${onBarNodeId}`, edgeIds);
  edges.push({
    id: edgeId,
    source: primaryNodeId,
    target: onBarNodeId,
    sourceHandle: "output",
    targetHandle: "input",
    type: "removable",
    data: { onRemoveEdge: () => args.onRemoveEdge(edgeId) },
  });
  return { primaryNodeId, nodes, edges };
}
