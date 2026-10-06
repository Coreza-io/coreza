import type { Node, XYPosition } from "@xyflow/react";
import type { NodeCluster } from "./types";
import {
  CLUSTER_FRAME_FOOTER_HEIGHT,
  CLUSTER_FRAME_HEADER_HEIGHT,
  getExpandedClusterFrameRect,
  getProjectedNodeRect,
} from "./projection";

export type InsertionSource = "drop" | "canvas-pointer" | "canvas-click" | "member-selection" | "fallback";

export interface InsertionIntent {
  position?: XYPosition;
  source: InsertionSource;
  selectedMemberId?: string;
  /** Cluster ownership captured with an explicit canvas/member action. */
  targetClusterId?: string | null;
  workflowSessionId: string;
}

export interface InsertionResolution {
  position: XYPosition;
  targetClusterId: string | null;
  reason?: "stale-session" | "stale-member" | "stale-cluster";
}

const NODE_GAP = 32;

export function resolveInsertionPosition(args: {
  intent?: InsertionIntent | null;
  fallbackPosition: XYPosition;
  nodes: readonly Node[];
  clusters: readonly NodeCluster[];
  expandedClusterId: string | null;
  workflowSessionId: string;
  zoom: number;
}): InsertionResolution {
  const { intent, fallbackPosition, nodes, clusters, expandedClusterId, workflowSessionId } = args;
  if (!intent) return { position: fallbackPosition, targetClusterId: null };
  if (intent.workflowSessionId !== workflowSessionId) return { position: fallbackPosition, targetClusterId: null, reason: "stale-session" };
  const cluster = expandedClusterId ? clusters.find(({ id }) => id === expandedClusterId) : undefined;

  if (intent.source !== "drop" && intent.targetClusterId !== undefined) {
    if (intent.targetClusterId === null) {
      return { position: intent.position ?? fallbackPosition, targetClusterId: null };
    }
    if (!cluster || cluster.id !== intent.targetClusterId) {
      return { position: fallbackPosition, targetClusterId: null, reason: "stale-cluster" };
    }
  }

  if (intent.source === "member-selection") {
    const member = nodes.find(({ id }) => id === intent.selectedMemberId);
    if (!member) return { position: fallbackPosition, targetClusterId: null, reason: "stale-member" };
    if (!cluster?.memberNodeIds.includes(member.id)
      || (intent.targetClusterId !== undefined && intent.targetClusterId !== cluster.id)) {
      return { position: fallbackPosition, targetClusterId: null, reason: "stale-cluster" };
    }
    const memberRect = getProjectedNodeRect(member);
    let position = { x: memberRect.x + memberRect.width + NODE_GAP, y: memberRect.y };
    const occupied = nodes.map(getProjectedNodeRect);
    while (occupied.some((rect) => position.x < rect.x + rect.width && position.x + memberRect.width > rect.x
      && position.y < rect.y + rect.height && position.y + memberRect.height > rect.y)) {
      position = { ...position, y: position.y + memberRect.height + NODE_GAP };
    }
    return { position, targetClusterId: cluster.id };
  }

  const position = intent.position ?? fallbackPosition;
  if (!cluster || !intent.position) return { position, targetClusterId: null };
  const frame = getExpandedClusterFrameRect(cluster, nodes);
  if (!frame) return { position, targetClusterId: null, reason: "stale-cluster" };
  const zoom = Math.max(args.zoom, 0.01);
  const bodyTop = frame.y + CLUSTER_FRAME_HEADER_HEIGHT / zoom;
  const bodyBottom = frame.y + frame.height - CLUSTER_FRAME_FOOTER_HEIGHT / zoom;
  const inside = position.x >= frame.x && position.x <= frame.x + frame.width
    && position.y >= bodyTop && position.y <= bodyBottom;
  if (intent.targetClusterId && !inside) {
    return { position: fallbackPosition, targetClusterId: null, reason: "stale-cluster" };
  }
  return { position, targetClusterId: inside ? cluster.id : null };
}
