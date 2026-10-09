import type { Edge, Node } from "@xyflow/react";
import { deleteNodesFromDocument, insertNodesInDocument, pasteNodesInDocument, renameNodeInDocument } from "../../src/domain/clusters/documentCommands";
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
  it("inserts a batch and cluster membership atomically without mutating the source", () => {
    const original = document();
    const inserted = node("c");
    inserted.position = { x: 500, y: 300 };
    const result = insertNodesInDocument(original, {
      nodes: [inserted],
      targetClusterId: original.clusters[0].id,
      expandedClusterId: original.clusters[0].id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(result.document.clusters[0].memberNodeIds).toEqual(["a", "b", "c"]);
    expect(original.nodes.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(original.clusters[0].memberNodeIds).toEqual(["a", "b"]);
  });

  it("rejects stale targets and invalid batches without returning a partial document", () => {
    const original = document();
    expect(insertNodesInDocument(original, {
      nodes: [node("c")],
      targetClusterId: original.clusters[0].id,
      expandedClusterId: null,
    })).toMatchObject({ ok: false, code: "stale-cluster" });
    expect(insertNodesInDocument(original, {
      nodes: [node("c")],
      edges: [{ id: "missing", source: "c", target: "absent" } as Edge],
    })).toMatchObject({ ok: false, code: "missing-endpoint" });
    expect(original.nodes).toHaveLength(2);
  });

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

describe('clipboard document transactions', () => {
  const batch = () => {
    const first = node('a2');
    first.data.values = { internal: "$('b').json", external: "$node['outside'].json" };
    return { nodes: [first, node('b2')], edges: [{ id: 'a2b2', source: 'a2', target: 'b2' }], idMap: { a: 'a2', b: 'b2' }, copiedClusters: document().clusters };
  };
  it('pastes into the open cluster, selects copies, remaps references and preserves originals', () => {
    const original = document();
    const before = structuredClone(original);
    const result = pasteNodesInDocument(original, { ...batch(), targetClusterId: original.clusters[0].id, expandedClusterId: original.clusters[0].id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.clusters).toHaveLength(1);
    expect(result.document.clusters[0].memberNodeIds).toEqual(['a', 'b', 'a2', 'b2']);
    expect(result.document.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['a2', 'b2']);
    expect(result.document.nodes[2].data.values).toEqual({ internal: "$('b2').json", external: "$node['outside'].json" });
    expect(original).toEqual(before);
  });
  it('recreates whole clusters only in the overview', () => {
    const result = pasteNodesInDocument(document(), batch());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.clusters[1]).toMatchObject({ title: 'Cluster 1 2', memberNodeIds: ['a2', 'b2'] });
    expect(result.document.clusters[1].id).not.toBe(result.document.clusters[0].id);
  });
  it('rejects a paste without mutating the document', () => {
    const original = document();
    const before = structuredClone(original);
    expect(pasteNodesInDocument(original, { ...batch(), targetClusterId: original.clusters[0].id })).toMatchObject({ ok: false });
    expect(original).toEqual(before);
  });
  it('remaps selectors simultaneously when new IDs match other copied IDs', () => {
    const request = batch();
    request.nodes[0].data.values = { value: "$('a').json + $('b').json" };
    const result = pasteNodesInDocument({ nodes: [], edges: [], clusters: [] }, { ...request, idMap: { a: 'b', b: 'c' }, copiedClusters: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.nodes[0].data.values).toEqual({ value: "$('b').json + $('c').json" });
  });
});


describe('cluster copy title allocation', () => {
  const workflow = (titles: string[]): WorkflowDocument => ({
    nodes: titles.map((_, index) => node(`member${index}`)),
    edges: [],
    clusters: titles.map((title, index) => ({ id: crypto.randomUUID(), title, memberNodeIds: [`member${index}`], note: 'Keep this note' })),
  });
  const copy = (current: WorkflowDocument, copiedClusters: WorkflowDocument['clusters']) => {
    const idMap = Object.fromEntries(copiedClusters.flatMap((cluster) => cluster.memberNodeIds.map((id) => [id, crypto.randomUUID()])));
    const result = pasteNodesInDocument(current, {
      nodes: Object.values(idMap).map(node), idMap, sourceNodes: current.nodes, copiedClusters,
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.message);
    for (const [index, cluster] of result.document.clusters.slice(current.clusters.length).entries()) {
      expect(cluster.id).not.toBe(copiedClusters[index].id);
      expect(cluster.memberNodeIds).toEqual(copiedClusters[index].memberNodeIds.map((id) => idMap[id]));
      expect(cluster.note).toBe(copiedClusters[index].note);
    }
    return result.document;
  };

  it('continues hl, hl 2, hl 3 when copying each newly pasted cluster', () => {
    const original = workflow(['hl']);
    const before = structuredClone(original);
    let current = original;
    for (const expected of ['hl 2', 'hl 3', 'hl 4']) {
      current = copy(current, [current.clusters[current.clusters.length - 1]]);
      expect(current.clusters[current.clusters.length - 1].title).toBe(expected);
    }
    expect(current.clusters.map(({ title }) => title)).toEqual(['hl', 'hl 2', 'hl 3', 'hl 4']);
    expect(original).toEqual(before);
  });

  it('reuses a free suffix without renaming existing clusters', () => {
    const current = workflow(['hl', 'hl 3']);
    expect(copy(current, [current.clusters[1]]).clusters.map(({ title }) => title)).toEqual(['hl', 'hl 3', 'hl 2']);
  });

  it('reserves trimmed case-insensitive titles while keeping copied spelling', () => {
    const current = workflow([' hl ', 'HL 2']);
    expect(copy(current, [current.clusters[1]]).clusters.map(({ title }) => title)).toEqual([' hl ', 'HL 2', 'HL 3']);
  });

  it('uses the complete clipboard family inventory and earlier batch reservations', () => {
    const current = workflow(['hl 2']);
    const clipboard = workflow(['hl 2', 'hl']);
    expect(copy(current, clipboard.clusters).clusters.map(({ title }) => title)).toEqual(['hl 2', 'hl 3', 'hl']);
  });

  it('preserves unrelated custom numeric titles', () => {
    const current = workflow(['Strategy 2026']);
    expect(copy(current, current.clusters).clusters.map(({ title }) => title)).toEqual(['Strategy 2026', 'Strategy 2026 2']);
  });
});
