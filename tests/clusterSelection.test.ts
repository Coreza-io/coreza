import type { Node } from "@xyflow/react";
import { resolveCanonicalSelection } from "@/domain/clusters/selection";
import type { NodeCluster } from "@/domain/clusters/types";

describe("cluster canonical selection", () => {
  it("deduplicates mixed node and cluster targets and ignores stale members", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, selected: true, data: {} },
      { id: "b", position: { x: 10, y: 0 }, data: {} },
      { id: "outside", position: { x: 20, y: 0 }, selected: true, data: {} },
    ];
    const clusters: NodeCluster[] = [
      { id: "cluster", title: "Signals", memberNodeIds: ["a", "b", "missing"] },
    ];

    expect(resolveCanonicalSelection(nodes, clusters, new Set(["cluster"])))
      .toEqual(["a", "outside", "b"]);
  });

  it("does not resolve members of unselected clusters", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 10, y: 0 }, selected: true, data: {} },
    ];
    const clusters: NodeCluster[] = [
      { id: "cluster", title: "Signals", memberNodeIds: ["a"] },
    ];

    expect(resolveCanonicalSelection(nodes, clusters, new Set())).toEqual(["b"]);
  });
});
