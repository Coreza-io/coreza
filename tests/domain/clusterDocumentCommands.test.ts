import type { Edge, Node } from "@xyflow/react";
import { deleteNodesFromDocument, renameNodeInDocument } from "../../src/domain/clusters/documentCommands";
import type { WorkflowDocument } from "../../src/domain/clusters/documentCommands";

const node = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: { node_type: "main", handles: [] } },
});

const document = (): WorkflowDocument => ({
  nodes: [node("a"), node("b")],
  edges: [{ id: "ab", source: "a", target: "b" } as Edge],
  clusters: [{
    id: "00000000-0000-4000-8000-000000000001",
    title: "Cluster 1",
    memberNodeIds: ["a", "b"],
  }],
});

describe("cluster-aware document commands", () => {
  it("renames nodes, endpoints, and membership in one result", () => {
    const result = renameNodeInDocument(document(), "a", "renamed").document;
    expect(result.nodes.map(({ id }) => id)).toContain("renamed");
    expect(result.edges[0]).toMatchObject({ source: "renamed", target: "b" });
    expect(result.clusters[0].memberNodeIds).toEqual(["b", "renamed"]);
  });

  it("keeps a valid singleton after deletion", () => {
    const result = deleteNodesFromDocument(document(), new Set(["a"]));
    expect(result.document.edges).toEqual([]);
    expect(result.document.clusters[0].memberNodeIds).toEqual(["b"]);
    expect(result.dissolvedClusters).toEqual([]);
  });

  it("does not silently discard an already-invalid cluster during an unrelated mutation", () => {
    const invalid = document();
    invalid.clusters[0].memberNodeIds.push("missing");
    const result = deleteNodesFromDocument(invalid, new Set(["a"]));
    expect(result.document.clusters).toHaveLength(1);
    expect(result.document.clusters[0].memberNodeIds).toEqual(["b", "missing"]);
    expect(result.dissolvedClusters).toEqual([]);
  });
});
