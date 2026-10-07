import type { Edge, Node } from "@xyflow/react";
import { projectClusterGraph } from "@/domain/clusters/projection";
import { reconcileClusterProjection } from "@/domain/clusters/reconcileProjection";
import type { NodeCluster } from "@/domain/clusters/types";

const cluster: NodeCluster = { id: "c", title: "Signals", memberNodeIds: ["a", "b"] };
const edges: Edge[] = [
  { id: "internal", source: "a", target: "b" },
  { id: "boundary", source: "b", target: "outside" },
];
const baseNodes: Node[] = [
  { id: "a", position: { x: 100, y: 100 }, data: {} },
  { id: "b", position: { x: 400, y: 100 }, data: {} },
  { id: "outside", position: { x: 900, y: 100 }, data: {} },
  { id: "far", position: { x: 2000, y: 2000 }, data: {} },
];
const onExpand = () => undefined;
const project = (nodes: Node[], runPhase: "idle" | "running" = "idle") =>
  projectClusterGraph(nodes, edges, [cluster], {}, onExpand, { getRunState: () => ({ phase: runPhase }) as never });

describe("cluster projection identity reuse", () => {
  it("returns the previous projection when nothing changed", () => {
    const first = project(baseNodes);
    expect(reconcileClusterProjection(first, project(baseNodes))).toBe(first);
  });

  it("keeps hidden hosts, compact card, and edges when an unrelated node moves", () => {
    const first = project(baseNodes);
    const moved = baseNodes.map((node) => node.id === "far" ? { ...node, position: { x: 2100, y: 2000 } } : node);
    const next = reconcileClusterProjection(first, project(moved));
    expect(next).not.toBe(first);
    const byId = (projection: typeof first, id: string) => projection.nodes.find((node) => node.id === id);
    expect(byId(next, "a")).toBe(byId(first, "a"));
    expect(byId(next, "b")).toBe(byId(first, "b"));
    const compact = first.nodes.find((node) => node.type === "compactCluster");
    expect(next.nodes.find((node) => node.type === "compactCluster")).toBe(compact);
    expect(byId(next, "far")?.position.x).toBe(2100);
    expect(next.edges).toBe(first.edges);
    expect(next.hiddenRuntimeHostIds).toBe(first.hiddenRuntimeHostIds);
    expect(next.displayNodeToCluster).toBe(first.displayNodeToCluster);
  });

  it("updates moved members and compact card position", () => {
    const first = project(baseNodes);
    const moved = baseNodes.map((node) => node.id === "a" ? { ...node, position: { x: 50, y: 100 } } : node);
    const next = reconcileClusterProjection(first, project(moved));
    expect(next.nodes.find((node) => node.id === "a")?.position.x).toBe(50);
    const card = next.nodes.find((node) => node.type === "compactCluster");
    expect(card).not.toBe(first.nodes.find((node) => node.type === "compactCluster"));
    expect(card?.position.x).toBe(26);
  });

  it("invalidates the compact card when run state changes", () => {
    const first = project(baseNodes);
    const next = reconcileClusterProjection(first, project(baseNodes, "running"));
    const card = next.nodes.find((node) => node.type === "compactCluster");
    expect((card?.data as { runState: { phase: string } }).runState.phase).toBe("running");
  });

  it("does not mutate the previous projection", () => {
    const first = project(baseNodes);
    const snapshot = JSON.stringify(first.nodes);
    reconcileClusterProjection(first, project(baseNodes.map((node) => ({ ...node, position: { x: 0, y: 0 } }))));
    expect(JSON.stringify(first.nodes)).toBe(snapshot);
  });
});
