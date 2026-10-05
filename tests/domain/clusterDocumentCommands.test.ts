import type { Edge, Node } from "@xyflow/react";
import { deleteNodesFromDocument, renameNodeInDocument } from "../../src/domain/clusters/documentCommands";
import type { WorkflowDocument } from "../../src/domain/clusters/documentCommands";

const node = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { displayName: id, definition: { node_type: "main", handles: [] } },
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
    expect(result.nodes.find(({ id }) => id === "renamed")?.data.displayName).toBe("renamed");
    expect(result.edges[0]).toMatchObject({ source: "renamed", target: "b" });
    expect(result.edges[0].id).toBe("ab");
    expect(result.clusters[0].memberNodeIds).toEqual(["renamed", "b"]);
  });

  it("preserves the complete OnBar chain when renaming its middle member", () => {
    const workflow: WorkflowDocument = {
      nodes: [node("BacktestInit"), node("OnBar"), node("Consolidator"), node("If")],
      edges: [
        { id: "init-onbar", source: "BacktestInit", target: "OnBar" } as Edge,
        { id: "onbar-consolidator", source: "OnBar", target: "Consolidator" } as Edge,
        { id: "consolidator-if", source: "Consolidator", target: "If" } as Edge,
      ],
      clusters: [],
    };
    const result = renameNodeInDocument(workflow, "OnBar", "Test").document;
    expect(result.nodes.map(({ id }) => id)).toEqual(["BacktestInit", "Test", "Consolidator", "If"]);
    expect(result.edges).toEqual([
      expect.objectContaining({ id: "init-onbar", source: "BacktestInit", target: "Test" }),
      expect.objectContaining({ id: "onbar-consolidator", source: "Test", target: "Consolidator" }),
      expect.objectContaining({ id: "consolidator-if", source: "Consolidator", target: "If" }),
    ]);
  });

  it("remaps supported selectors without changing similar text or edge identities", () => {
    const workflow = document();
    workflow.nodes[1] = {
      ...workflow.nodes[1],
      data: {
        ...workflow.nodes[1].data,
        values: {
          direct: "{{ $('a').json.value }}",
          bracket: '{{ $node["a"].json.value }}',
          similar: "{{ $('aa').json.value }}",
          text: "a",
        },
        fieldState: ["prefix {{ $('a').json.value }} suffix"],
      },
    };
    const result = renameNodeInDocument(workflow, "a", "renamed").document;
    expect(result.nodes[1].data.values).toEqual({
      direct: "{{ $('renamed').json.value }}",
      bracket: '{{ $node["renamed"].json.value }}',
      similar: "{{ $('aa').json.value }}",
      text: "a",
    });
    expect(result.nodes[1].data.fieldState).toEqual(["prefix {{ $('renamed').json.value }} suffix"]);
    expect(result.edges[0].id).toBe("ab");
  });

  it("rejects missing sources and destination collisions without mutating the document", () => {
    const original = document();
    expect(() => renameNodeInDocument(original, "missing", "new")).toThrow("does not exist");
    expect(() => renameNodeInDocument(original, "a", "b")).toThrow("already exists");
    expect(original.nodes.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(original.clusters[0].memberNodeIds).toEqual(["a", "b"]);
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
