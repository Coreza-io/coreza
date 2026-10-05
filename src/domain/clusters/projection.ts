import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { NodeCluster } from "./types";
import type { ClusterViewState } from "./viewState";
import { isClusterExpanded } from "./viewState";
import type { ClusterRunState } from "@/hooks/useClusterExecution";
import { CLUSTER_RUNTIME_HOST_CLASS } from "./canonicalNode";

export const CLUSTER_DISPLAY_ID_PREFIX = "__coreza_cluster_display__:";
export const COMPACT_CLUSTER_WIDTH = 280;
export const COMPACT_CLUSTER_HEIGHT = 180;
export const CLUSTER_FRAME_PADDING = 24;
export const CLUSTER_FRAME_HEADER_HEIGHT = 42;
export const CLUSTER_FRAME_FOOTER_HEIGHT = 52;
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;

export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompactClusterNodeData extends Record<string, unknown> {
  clusterId: string;
  title: string;
  note?: string;
  memberCount: number;
  runState: ClusterRunState;
  incomingHandleIds: string[];
  outgoingHandleIds: string[];
  onExpand: (clusterId: string) => void;
  onExecute: (clusterId: string) => void;
  onCancel: (clusterId: string) => void;
}

export type CompactClusterFlowNode = Node<CompactClusterNodeData, "compactCluster">;

export interface ClusterProjection {
  nodes: Node[];
  edges: Edge[];
  displayNodeToCluster: ReadonlyMap<string, string>;
  displayEdgeToCanonicalEdge: ReadonlyMap<string, string>;
  hiddenRuntimeHostIds: ReadonlySet<string>;
  visibleNodeIds: ReadonlySet<string>;
}

export interface ClusterProjectionOptions {
  focusedClusterId?: string | null;
  draggable?: boolean;
  selectedClusterIds?: ReadonlySet<string>;
  getRunState?: (clusterId: string) => ClusterRunState;
  onExecute?: (clusterId: string) => void;
  onCancel?: (clusterId: string) => void;
}

const asRuntimeHost = (node: Node): Node => ({
  ...node,
  className: [node.className, CLUSTER_RUNTIME_HOST_CLASS].filter(Boolean).join(" "),
  style: { ...node.style, visibility: "hidden", pointerEvents: "none", transition: "none", animation: "none" },
  domAttributes: { ...node.domAttributes, "aria-hidden": true },
  draggable: false,
  selectable: false,
  connectable: false,
  deletable: false,
  focusable: false,
  selected: false,
});

export const getVisibleClusterNodes = (projection: ClusterProjection): Node[] =>
  projection.nodes.filter(({ id }) => !projection.hiddenRuntimeHostIds.has(id));

export const getClusterDisplayNodeId = (clusterId: string): string =>
  `${CLUSTER_DISPLAY_ID_PREFIX}${clusterId}`;

export const getCompactClusterPosition = (members: readonly Node[]): XYPosition => {
  const minX = Math.min(...members.map(({ position }) => position.x));
  const minY = Math.min(...members.map(({ position }) => position.y));
  return { x: minX - 24, y: minY - 66 };
};

export const getProjectedNodeRect = (node: Node): FlowRect => ({
  x: node.position.x,
  y: node.position.y,
  width: node.type === "compactCluster"
    ? COMPACT_CLUSTER_WIDTH
    : node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH,
  height: node.type === "compactCluster"
    ? COMPACT_CLUSTER_HEIGHT
    : node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT,
});

export const getExpandedClusterFrameRect = (
  cluster: NodeCluster | undefined,
  canonicalNodes: readonly Node[],
): FlowRect | null => {
  if (!cluster) return null;
  const nodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
  const members = [...new Set(cluster.memberNodeIds)].flatMap((id) => {
    const member = nodeById.get(id);
    return member ? [member] : [];
  });
  if (members.length === 0) return null;
  const rects = members.map(getProjectedNodeRect);
  const minX = Math.min(...rects.map(({ x }) => x)) - CLUSTER_FRAME_PADDING;
  const minY = Math.min(...rects.map(({ y }) => y)) - CLUSTER_FRAME_PADDING - CLUSTER_FRAME_HEADER_HEIGHT;
  const maxX = Math.max(...rects.map(({ x, width }) => x + width)) + CLUSTER_FRAME_PADDING;
  const maxY = Math.max(...rects.map(({ y, height }) => y + height)) + CLUSTER_FRAME_PADDING + CLUSTER_FRAME_FOOTER_HEIGHT;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const hasPositiveAreaIntersection = (a: FlowRect, b: FlowRect): boolean =>
  a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
  && a.x < b.x + b.width
  && a.x + a.width > b.x
  && a.y < b.y + b.height
  && a.y + a.height > b.y;

export function projectClusterGraph(
  canonicalNodes: readonly Node[],
  canonicalEdges: readonly Edge[],
  clusters: readonly NodeCluster[],
  viewState: ClusterViewState,
  onExpand: (clusterId: string) => void,
  options: ClusterProjectionOptions = {},
): ClusterProjection {
  const nodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
  const collapsedOwnerByNode = new Map<string, NodeCluster>();
  const displayNodeToCluster = new Map<string, string>();
  const displayEdgeToCanonicalEdge = new Map<string, string>();
  const displayIdByCluster = new Map<string, string>();
  const isExpanded = (clusterId: string): boolean =>
    clusterId === options.focusedClusterId || isClusterExpanded(viewState, clusterId);

  for (const cluster of clusters) {
    if (isExpanded(cluster.id)) continue;
    for (const memberId of cluster.memberNodeIds) collapsedOwnerByNode.set(memberId, cluster);
  }

  // Allocate every synthetic ID before rewriting edges. An allocation may need
  // a suffix when a canonical node uses the reserved prefix, so deriving edge
  // endpoints from the unsuffixed ID would leave those edges dangling.
  const reservedIds = new Set(canonicalNodes.map(({ id }) => id));
  for (const cluster of clusters) {
    if (isExpanded(cluster.id)) continue;
    const baseId = getClusterDisplayNodeId(cluster.id);
    let id = baseId;
    let collisionIndex = 1;
    while (reservedIds.has(id)) {
      id = `${baseId}:${collisionIndex}`;
      collisionIndex += 1;
    }
    reservedIds.add(id);
    displayIdByCluster.set(cluster.id, id);
    displayNodeToCluster.set(id, cluster.id);
  }

  const projectedEdges: Edge[] = [];
  const incomingHandles = new Map<string, string[]>();
  const outgoingHandles = new Map<string, string[]>();
  for (const edge of canonicalEdges) {
    const sourceCluster = collapsedOwnerByNode.get(edge.source);
    const targetCluster = collapsedOwnerByNode.get(edge.target);
    if (sourceCluster && sourceCluster.id === targetCluster?.id) continue;

    const projectedSource = sourceCluster
      ? displayIdByCluster.get(sourceCluster.id) ?? edge.source
      : edge.source;
    const projectedTarget = targetCluster
      ? displayIdByCluster.get(targetCluster.id) ?? edge.target
      : edge.target;
    const projectedSourceHandle = sourceCluster ? `out:${edge.id}` : edge.sourceHandle;
    const projectedTargetHandle = targetCluster ? `in:${edge.id}` : edge.targetHandle;
    if (sourceCluster) outgoingHandles.set(sourceCluster.id, [...(outgoingHandles.get(sourceCluster.id) ?? []), projectedSourceHandle]);
    if (targetCluster) incomingHandles.set(targetCluster.id, [...(incomingHandles.get(targetCluster.id) ?? []), projectedTargetHandle]);
    projectedEdges.push(sourceCluster || targetCluster ? {
      ...edge,
      source: projectedSource,
      target: projectedTarget,
      sourceHandle: projectedSourceHandle,
      targetHandle: projectedTargetHandle,
      data: {
        ...edge.data,
        canonicalSource: edge.source,
        canonicalTarget: edge.target,
        canonicalSourceHandle: edge.sourceHandle,
        canonicalTargetHandle: edge.targetHandle,
      },
    } : edge);
    displayEdgeToCanonicalEdge.set(edge.id, edge.id);
  }

  // React Flow's `hidden` property removes a node component from the render
  // tree. Keep collapsed members in the projection instead, while disabling
  // every display-layer interaction so component-owned runtimes stay alive.
  const displayNodes = canonicalNodes.map((node): Node => collapsedOwnerByNode.has(node.id) ? asRuntimeHost(node) : node);
  for (const cluster of clusters) {
    if (isExpanded(cluster.id)) continue;
    const members = cluster.memberNodeIds.flatMap((id) => {
      const member = nodeById.get(id);
      return member ? [member] : [];
    });
    if (members.length === 0) continue;
    const id = displayIdByCluster.get(cluster.id);
    if (!id) continue;
    const compactNode: CompactClusterFlowNode = {
      id,
      type: "compactCluster",
      position: getCompactClusterPosition(members),
      draggable: options.draggable ?? false,
      deletable: false,
      selectable: true,
      selected: options.selectedClusterIds?.has(cluster.id) ?? false,
      width: COMPACT_CLUSTER_WIDTH,
      height: COMPACT_CLUSTER_HEIGHT,
      data: {
        clusterId: cluster.id,
        title: cluster.title,
        note: cluster.note,
        memberCount: members.length,
        runState: options.getRunState?.(cluster.id) ?? { phase: "idle" },
        incomingHandleIds: incomingHandles.get(cluster.id) ?? [],
        outgoingHandleIds: outgoingHandles.get(cluster.id) ?? [],
        onExpand,
        onExecute: options.onExecute ?? (() => undefined),
        onCancel: options.onCancel ?? (() => undefined),
      } satisfies CompactClusterNodeData,
    };
    displayNodes.push(compactNode);
  }

  // This compatibility field now includes both collapsed canonical runtime
  // hosts and temporarily occluded display nodes (including synthetic cards).
  const hiddenRuntimeHostIds = new Set(collapsedOwnerByNode.keys());
  const focusedCluster = options.focusedClusterId
    ? clusters.find(({ id }) => id === options.focusedClusterId)
    : undefined;
  const focusedMemberIds = new Set(focusedCluster?.memberNodeIds.filter((id) => nodeById.has(id)) ?? []);
  const frameRect = getExpandedClusterFrameRect(focusedCluster, canonicalNodes);
  if (frameRect) {
    for (const node of displayNodes) {
      if (hiddenRuntimeHostIds.has(node.id) || focusedMemberIds.has(node.id)) continue;
      if (hasPositiveAreaIntersection(frameRect, getProjectedNodeRect(node))) hiddenRuntimeHostIds.add(node.id);
    }
  }
  const occludedDisplayNodes = displayNodes.map((node) =>
    hiddenRuntimeHostIds.has(node.id) && !collapsedOwnerByNode.has(node.id) ? asRuntimeHost(node) : node);
  return {
    nodes: occludedDisplayNodes,
    edges: projectedEdges.filter((edge) =>
      !hiddenRuntimeHostIds.has(edge.source) && !hiddenRuntimeHostIds.has(edge.target)),
    displayNodeToCluster,
    displayEdgeToCanonicalEdge,
    hiddenRuntimeHostIds,
    visibleNodeIds: new Set(occludedDisplayNodes.filter(({ id }) => !hiddenRuntimeHostIds.has(id)).map(({ id }) => id)),
  };
}
