import type { Edge, Node } from "@xyflow/react";
import { CLUSTER_DISPLAY_ID_PREFIX, projectClusterGraph } from "@/domain/clusters/projection";
import { isClusterExpanded, reconcileClusterViewState, setClusterExpanded } from "@/domain/clusters/viewState";
import type { NodeCluster } from "@/domain/clusters/types";
import { CLUSTER_COLLAPSE_ENABLED } from "@/domain/clusters/capabilities";

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
  it("keeps collapse unavailable until renderer-independent execution is verified", () => {
    expect(CLUSTER_COLLAPSE_ENABLED).toBe(false);
  });

  it("defaults missing clusters to compact and removes stale entries", () => {
    expect(isClusterExpanded({}, cluster.id)).toBe(false);
    const expanded = setClusterExpanded({}, cluster.id, true);
    expect(isClusterExpanded(expanded, cluster.id)).toBe(true);
    expect(reconcileClusterViewState({ ...expanded, stale: true }, [cluster])).toEqual({ [cluster.id]: true });
  });
});

describe("cluster display projection", () => {
  it("replaces collapsed members with one fixed card and projects boundary handles", () => {
    const projection = projectClusterGraph(nodes, edges, [cluster], {}, jest.fn());
    const displayId = `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`;

    expect(projection.nodes.map(({ id }) => id)).toEqual(["outside", displayId]);
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

  it("returns canonical graph objects when expanded without changing positions", () => {
    const projection = projectClusterGraph(nodes, edges, [cluster], { [cluster.id]: true }, jest.fn());
    expect(projection.nodes).toEqual(nodes);
    expect(projection.edges).toEqual(edges);
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

  it("allocates a display ID that cannot collide with a canonical node", () => {
    const collidingNode: Node = {
      id: `${CLUSTER_DISPLAY_ID_PREFIX}${cluster.id}`,
      position: { x: 900, y: 120 },
      data: {},
    };
    const projection = projectClusterGraph([...nodes, collidingNode], edges, [cluster], {}, jest.fn());
    expect(new Set(projection.nodes.map(({ id }) => id)).size).toBe(projection.nodes.length);
    expect(projection.displayNodeToCluster.has(`${collidingNode.id}:1`)).toBe(true);
  });
});
