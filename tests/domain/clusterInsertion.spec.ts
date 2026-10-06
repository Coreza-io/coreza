import type { Node } from "@xyflow/react";
import { resolveInsertionPosition } from "../../src/domain/clusters/insertion";
import type { NodeCluster } from "../../src/domain/clusters/types";

const nodes: Node[] = [
  { id: "a", position: { x: 100, y: 100 }, width: 100, height: 100, data: {} },
  { id: "b", position: { x: 300, y: 100 }, width: 100, height: 100, data: {} },
];
const cluster: NodeCluster = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Cluster",
  memberNodeIds: ["a", "b"],
};

describe("cluster insertion placement", () => {
  it("targets only the expanded content body and honors zoom-adjusted controls", () => {
    const resolve = (y: number) => resolveInsertionPosition({
      intent: { source: "drop", position: { x: 200, y }, workflowSessionId: "session" },
      fallbackPosition: { x: 0, y: 0 },
      nodes,
      clusters: [cluster],
      expandedClusterId: cluster.id,
      workflowSessionId: "session",
      zoom: 2,
    });
    expect(resolve(50).targetClusterId).toBeNull();
    expect(resolve(100).targetClusterId).toBe(cluster.id);
    expect(resolve(260).targetClusterId).toBeNull();
  });

  it("places beside a selected member and rejects stale session intent", () => {
    const selected = resolveInsertionPosition({
      intent: { source: "member-selection", selectedMemberId: "b", workflowSessionId: "session" },
      fallbackPosition: { x: 0, y: 0 }, nodes, clusters: [cluster], expandedClusterId: cluster.id,
      workflowSessionId: "session", zoom: 1,
    });
    expect(selected).toEqual({ position: { x: 432, y: 100 }, targetClusterId: cluster.id });
    expect(resolveInsertionPosition({
      intent: { source: "drop", position: { x: 200, y: 100 }, workflowSessionId: "old" },
      fallbackPosition: { x: 9, y: 9 }, nodes, clusters: [cluster], expandedClusterId: cluster.id,
      workflowSessionId: "session", zoom: 1,
    })).toEqual({ position: { x: 9, y: 9 }, targetClusterId: null, reason: "stale-session" });
  });

  it("preserves an explicit outside anchor and rejects a captured cluster after focus changes", () => {
    const outside = resolveInsertionPosition({
      intent: {
        source: "canvas-click",
        position: { x: 900, y: 900 },
        targetClusterId: null,
        workflowSessionId: "session",
      },
      fallbackPosition: { x: 0, y: 0 }, nodes, clusters: [cluster], expandedClusterId: cluster.id,
      workflowSessionId: "session", zoom: 1,
    });
    expect(outside).toEqual({ position: { x: 900, y: 900 }, targetClusterId: null });

    const stale = resolveInsertionPosition({
      intent: {
        source: "canvas-pointer",
        position: { x: 200, y: 100 },
        targetClusterId: cluster.id,
        workflowSessionId: "session",
      },
      fallbackPosition: { x: 9, y: 9 }, nodes, clusters: [cluster], expandedClusterId: null,
      workflowSessionId: "session", zoom: 1,
    });
    expect(stale).toEqual({ position: { x: 9, y: 9 }, targetClusterId: null, reason: "stale-cluster" });
  });
});
