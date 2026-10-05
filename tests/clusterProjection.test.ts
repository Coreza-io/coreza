import type { Edge, Node } from "@xyflow/react";
import { CLUSTER_DISPLAY_ID_PREFIX, getVisibleClusterNodes, projectClusterGraph } from "@/domain/clusters/projection";
import { closeFocusedCluster, hasValidClusterMembers, isClusterExpanded, openFocusedCluster, reconcileClusterViewState, reconcileFocusedCluster, setClusterExpanded } from "@/domain/clusters/viewState";
import type { NodeCluster } from "@/domain/clusters/types";
import {
  CLUSTER_COLLAPSE_ENABLED,
  COLLAPSED_CLUSTER_MEMBERS_STAY_MOUNTED,
} from "@/domain/clusters/capabilities";

const nodes: Node[] = [
  { id: "a", position: { x: 100, y: 120 }, data: {} },
  { id: "b", position: { x: 400, y: 120 }, data: {} },
  { id: "outside", position: { x: 700, y: 120 }, data: {} },
];
const edges: Edge[] = [
  { id: "internal", source: "a", sourceHandle: "main", target: "b", targetHandle: "in" },
  { id: "boundary", source: "b", sourceHandle: "out", target: "outside", targetHandle: "in" },
];
const cluster: NodeCluster = { id: "cluster-id", title: "Signals", note: "A note", memberNodeIds: ["a", "b"] };

describe("cluster view state", () => {
  it("enables collapse only with mounted runtime preservation", () => {
    expect(COLLAPSED_CLUSTER_MEMBERS_STAY_MOUNTED).toBe(true);
    expect(CLUSTER_COLLAPSE_ENABLED).toBe(COLLAPSED_CLUSTER_MEMBERS_STAY_MOUNTED);
  });

  it("defaults missing clusters to compact and removes stale entries", () => {
    expect(isClusterExpanded({}, cluster.id)).toBe(false);
    const expanded = setClusterExpanded({}, cluster.id, true);
    expect(isClusterExpanded(expanded, cluster.id)).toBe(true);
    expect(reconcileClusterViewState({ ...expanded, stale: true }, [cluster])).toEqual({ [cluster.id]: true });
  });

  it("opens, switches, closes, and reconciles one focused cluster", () => {
    const second: NodeCluster = { id: "second", title: "Orders", memberNodeIds: ["outside"] };
    expect(openFocusedCluster(null, cluster.id, [cluster, second])).toBe(cluster.id);
    expect(openFocusedCluster(cluster.id, second.id, [cluster, second])).toBe(second.id);
    expect(openFocusedCluster(cluster.id, "missing", [cluster, second])).toBe(cluster.id);
    expect(reconcileFocusedCluster(cluster.id, [second])).toBeNull();
    expect(reconcileFocusedCluster(cluster.id, [cluster], new Set(["outside"]))).toBeNull();
    expect(hasValidClusterMembers(cluster, new Set(["a"]))).toBe(true);
    expect(hasValidClusterMembers({ ...cluster, memberNodeIds: [] })).toBe(false);
    expect(closeFocusedCluster()).toBeNull();
  });
});

describe("cluster display projection", () => {
  it("preserves collapsed runtime hosts beside one compact card and projects boundary handles", () => {
    const projection = projectClusterGraph(nodes, edges, [cluster], {}, jest.fn());
    const displayId = `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`;

    expect(projection.nodes.map(({ id }) => id)).toEqual(["a", "b", "outside", displayId]);
    expect(getVisibleClusterNodes(projection).map(({ id }) => id)).toEqual(["outside", displayId]);
    expect(getVisibleClusterNodes(projection).filter(({ type }) => type === "compactCluster")).toHaveLength(1);
    expect(projection.hiddenRuntimeHostIds).toEqual(new Set(["a", "b"]));
    for (const member of projection.nodes.filter(({ id }) => projection.hiddenRuntimeHostIds.has(id))) {
      expect(member).toMatchObject({
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        selected: false,
        style: {
          visibility: "hidden",
          pointerEvents: "none",
          transition: "none",
          animation: "none",
        },
        domAttributes: { "aria-hidden": true },
      });
      expect(member.data).toBe(nodes.find(({ id }) => id === member.id)?.data);
    }
    expect(projection.edges).toHaveLength(1);
    expect(projection.edges[0]).toMatchObject({
      id: "boundary",
      source: displayId,
      sourceHandle: "out:boundary",
      target: "outside",
      targetHandle: "in",
      data: {
        canonicalSource: "b",
        canonicalTarget: "outside",
        canonicalSourceHandle: "out",
        canonicalTargetHandle: "in",
      },
    });
    expect(projection.displayNodeToCluster.get(displayId)).toBe(cluster.id);
    expect(projection.displayEdgeToCanonicalEdge.get("boundary")).toBe("boundary");
  });

  it("projects canonical execution state and callbacks without persisting them", () => {
    const onExecute = jest.fn();
    const onCancel = jest.fn();
    const projection = projectClusterGraph(nodes, edges, [cluster], {}, jest.fn(), {
      getRunState: () => ({ phase: "running", runId: "run-id" }),
      onExecute,
      onCancel,
    });
    const compact = projection.nodes.find(({ type }) => type === "compactCluster");

    expect(compact?.data).toMatchObject({
      clusterId: cluster.id,
      runState: { phase: "running", runId: "run-id" },
      onExecute,
      onCancel,
    });
    expect(cluster).toEqual({ id: "cluster-id", title: "Signals", note: "A note", memberNodeIds: ["a", "b"] });
  });

  it("returns canonical graph objects when expanded without changing positions", () => {
    const projection = projectClusterGraph(nodes, edges, [cluster], { [cluster.id]: true }, jest.fn());
    expect(projection.nodes).toEqual(nodes);
    expect(projection.edges).toEqual(edges);
    expect(projection.hiddenRuntimeHostIds.size).toBe(0);
  });

  it("isolates a focused cluster by membership while preserving hidden runtime hosts", () => {
    const projection = projectClusterGraph(nodes, edges, [cluster], {}, jest.fn(), {
      focusedClusterId: cluster.id,
    });

    expect(projection.visibleNodeIds).toEqual(new Set(["a", "b"]));
    expect(projection.hiddenRuntimeHostIds).toEqual(new Set(["outside"]));
    expect(getVisibleClusterNodes(projection).map(({ id }) => id)).toEqual(["a", "b"]);
    expect(projection.nodes.some(({ type }) => type === "compactCluster")).toBe(false);
    expect(projection.edges).toEqual([edges[0]]);
    expect(projection.nodes.find(({ id }) => id === "outside")?.data).toBe(nodes[2].data);
    expect(nodes[2].position).toEqual({ x: 700, y: 120 });
  });

  it("derives focus from IDs rather than geometry without mutating canonical inputs", () => {
    const overlappingNodes = nodes.map((node) => ({ ...node, position: { x: 100, y: 100 } }));
    const originalEdges = structuredClone(edges);
    const first = projectClusterGraph(overlappingNodes, edges, [cluster], {}, jest.fn(), { focusedClusterId: cluster.id });
    const closed = projectClusterGraph(overlappingNodes, edges, [cluster], {}, jest.fn());
    const reopened = projectClusterGraph(overlappingNodes, edges, [cluster], {}, jest.fn(), { focusedClusterId: cluster.id });

    expect(first.visibleNodeIds).toEqual(new Set(["a", "b"]));
    expect(reopened.visibleNodeIds).toEqual(first.visibleNodeIds);
    expect(first.nodes.find(({ id }) => id === "a")).toBe(overlappingNodes[0]);
    expect(reopened.nodes.find(({ id }) => id === "b")).toBe(overlappingNodes[1]);
    expect(closed.nodes.find(({ id }) => id === "outside")).toBe(overlappingNodes[2]);
    expect(edges).toEqual(originalEdges);
  });

  it("projects both endpoints for edges between collapsed clusters", () => {
    const second: NodeCluster = { id: "second", title: "Orders", memberNodeIds: ["outside"] };
    const projection = projectClusterGraph(nodes, edges, [cluster, second], {}, jest.fn());
    expect(projection.edges[0]).toMatchObject({
      source: `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`,
      target: `${CLUSTER_DISPLAY_ID_PREFIX}${second.id}`,
      sourceHandle: "out:boundary",
      targetHandle: "in:boundary",
    });
  });

  it("does not mutate the canonical document during repeated toggles", () => {
    const originalNodes = structuredClone(nodes);
    const originalEdges = structuredClone(edges);
    projectClusterGraph(nodes, edges, [cluster], {}, jest.fn());
    projectClusterGraph(nodes, edges, [cluster], { [cluster.id]: true }, jest.fn());
    expect(nodes).toEqual(originalNodes);
    expect(edges).toEqual(originalEdges);
  });

  it("keeps component-owned runtime data registered across repeated toggles", () => {
    const listener = jest.fn();
    const runtimeNodes: Node[] = nodes.map((node) => node.id === "a"
      ? { ...node, data: { ...node.data, listener } }
      : node);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const collapsed = projectClusterGraph(runtimeNodes, edges, [cluster], {}, jest.fn());
      const runtimeHost = collapsed.nodes.find(({ id }) => id === "a");
      expect(runtimeHost?.data.listener).toBe(listener);
      expect(collapsed.hiddenRuntimeHostIds.has("a")).toBe(true);

      const expanded = projectClusterGraph(runtimeNodes, edges, [cluster], { [cluster.id]: true }, jest.fn());
      expect(expanded.nodes.find(({ id }) => id === "a")).toBe(runtimeNodes[0]);
    }
  });

  it("allocates a display ID that cannot collide with a canonical node", () => {
    const collidingNode: Node = {
      id: `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`,
      position: { x: 900, y: 120 },
      data: {},
    };
    const projection = projectClusterGraph([...nodes, collidingNode], edges, [cluster], {}, jest.fn());
    expect(new Set(projection.nodes.map(({ id }) => id)).size).toBe(projection.nodes.length);
    expect(projection.displayNodeToCluster.has(`${collidingNode.id}:1`)).toBe(true);
    expect(projection.edges[0]).toMatchObject({
      source: `${collidingNode.id}:1`,
      target: "outside",
    });
    const displayNodeIds = new Set(projection.nodes.map(({ id }) => id));
    expect(displayNodeIds.has(projection.edges[0].source)).toBe(true);
    expect(displayNodeIds.has(projection.edges[0].target)).toBe(true);
  });

  it("uses final collision-safe IDs at both ends of a compact-to-compact edge", () => {
    const second: NodeCluster = { id: "second", title: "Orders", memberNodeIds: ["outside"] };
    const collidingNodes: Node[] = [
      { id: `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`, position: { x: 900, y: 120 }, data: {} },
      { id: `${CLUSTER_DISPLAY_ID_PREFIX}${second.id}`, position: { x: 1100, y: 120 }, data: {} },
    ];

    const projection = projectClusterGraph([...nodes, ...collidingNodes], edges, [cluster, second], {}, jest.fn());

    expect(projection.edges[0]).toMatchObject({
      source: `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}:1`,
      target: `${CLUSTER_DISPLAY_ID_PREFIX}${second.id}:1`,
    });
    expect(projection.displayNodeToCluster.get(projection.edges[0].source)).toBe(cluster.id);
    expect(projection.displayNodeToCluster.get(projection.edges[0].target)).toBe(second.id);
  });
});
