import type { Node, Edge } from "@xyflow/react";
import { resolveClusterHierarchy } from "@/domain/clusters/hierarchy";
import { validateClusters } from "@/domain/clusters/validate";
import { parseNodeClusters } from "@/domain/clusters/parse";
import { recoverClusterDocument } from "@/domain/clusters/recovery";
import {
  groupSelectionInDocument,
  dissolveClusterInDocument,
  deleteNodesFromDocument,
  pasteNodesInDocument,
  insertNodesInDocument,
} from "@/domain/clusters/documentCommands";
import {
  projectClusterGraph,
  getExpandedClusterFrameRect,
} from "@/domain/clusters/projection";
import {
  focusedClusterToViewState,
  closeFocusedCluster,
} from "@/domain/clusters/viewState";
import { resolveInsertionPosition } from "@/domain/clusters/insertion";
import { buildClusterExecutionPlan } from "@/hooks/useClusterExecution";
import { applyClusterExecutionVisuals } from "@/domain/clusters/executionVisuals";
import {
  serializeWorkflowContent,
  hashEditableWorkflowContent,
} from "@/domain/workflowDocument";
const outer = "11111111-1111-4111-8111-111111111111";
const inner = "22222222-2222-4222-8222-222222222222";
const third = "33333333-3333-4333-8333-333333333333";
const node = (id: string, x = 0): Node => ({
  id,
  position: { x, y: 100 },
  data: {
    definition: { name: id, node_type: "main", manualExecution: "available" },
  },
});
const nodes = [node("a", 100), node("b", 450), node("c", 900)];
const edges: Edge[] = [
  { id: "ab", source: "a", target: "b" },
  { id: "bc", source: "b", target: "c" },
];
const clusters = [
  {
    id: inner,
    title: "Inner",
    memberNodeIds: ["a", "b"],
    parentClusterId: outer,
  },
  { id: outer, title: "Outer", memberNodeIds: ["c"] },
];
const document = () => ({ nodes, edges, clusters });
it("resolves unordered hierarchy and preserves it through normalization/serialization", () => {
  const h = resolveClusterHierarchy(
    clusters,
    nodes.map((n) => n.id),
  );
  expect(h.diagnostics).toEqual([]);
  expect(h.effectiveMembers.get(outer)).toEqual(["c", "a", "b"]);
  expect(
    resolveClusterHierarchy([...clusters].reverse()).effectiveMembers.get(
      outer,
    ),
  ).toEqual(h.effectiveMembers.get(outer));
  expect(validateClusters(nodes, edges, clusters).valid).toBe(true);
  expect(parseNodeClusters(clusters).clusters).toEqual(clusters);
  const original = serializeWorkflowContent(
    "Workflow",
    null,
    nodes,
    edges,
    clusters,
  );
  const detached = serializeWorkflowContent(
    "Workflow",
    null,
    nodes,
    edges,
    clusters.map((c) => ({ ...c, parentClusterId: undefined })),
  );
  expect(hashEditableWorkflowContent(original)).not.toBe(
    hashEditableWorkflowContent(detached),
  );
});
it.each([null, "", 42])("refuses malformed parent %p", (parentClusterId) => {
  expect(
    parseNodeClusters([{ ...clusters[0], parentClusterId }]).invalidIndexes,
  ).toEqual([0]);
});
it("refuses cycles, missing parents, duplicate owners and depth overflow", () => {
  expect(
    resolveClusterHierarchy([
      { ...clusters[0], parentClusterId: inner },
    ]).diagnostics.map((d) => d.code),
  ).toContain("self-parent");
  expect(
    resolveClusterHierarchy([
      { ...clusters[0], parentClusterId: third },
    ]).diagnostics.map((d) => d.code),
  ).toContain("missing-parent");
  expect(
    resolveClusterHierarchy([
      clusters[0],
      { ...clusters[1], parentClusterId: inner },
    ]).diagnostics.map((d) => d.code),
  ).toContain("cluster-cycle");
  expect(
    resolveClusterHierarchy([
      ...clusters,
      { id: third, memberNodeIds: [], parentClusterId: inner },
    ]).diagnostics.map((d) => d.code),
  ).toContain("cluster-depth");
  const h = resolveClusterHierarchy([
    clusters[0],
    { ...clusters[1], memberNodeIds: ["a"] },
  ]);
  expect(h.diagnostics.map((d) => d.clusterId)).toEqual(
    expect.arrayContaining([outer, inner]),
  );
  expect(h.effectiveMembers.size).toBe(0);
});
it("recovers only intact components and retains original source indexes", () => {
  const raw = [
    { broken: true },
    { ...clusters[0], memberNodeIds: ["missing"] },
    clusters[1],
    { id: third, title: "Safe", memberNodeIds: ["b"] },
  ];
  const recovered = recoverClusterDocument(raw, nodes, []);
  expect(recovered.clusters.map((c) => c.id)).toEqual([third]);
  expect(recovered.invalidEntries).toEqual(
    raw.slice(0, 3).map((value, index) => ({ index, value })),
  );
  expect(
    recoverClusterDocument(
      [clusters[0], { ...clusters[1], memberNodeIds: [] }],
      nodes,
      [],
    ).invalidEntries,
  ).toEqual([]);
});
it("creates an inner, wraps roots atomically, and refuses a third level", () => {
  const flat = {
    nodes,
    edges,
    clusters: [{ ...clusters[1], memberNodeIds: ["a", "b", "c"] }],
  };
  const created = groupSelectionInDocument(flat, ["a", "b"], new Set(), {
    id: inner,
    title: "Inner",
    memberNodeIds: [],
  });
  expect(created.ok).toBe(true);
  if (created.ok === false) return;
  expect(created.document.clusters[0].memberNodeIds).toEqual(["c"]);
  expect(created.document.clusters[1]).toMatchObject({
    parentClusterId: outer,
    memberNodeIds: ["a", "b"],
  });
  expect(
    groupSelectionInDocument(created.document, ["a", "b"], new Set(), {
      id: third,
      title: "Third",
      memberNodeIds: [],
    }).ok,
  ).toBe(false);
  const roots = {
    nodes,
    edges,
    clusters: [{ id: inner, title: "Inner", memberNodeIds: ["a", "b"] }],
  };
  const wrapped = groupSelectionInDocument(
    roots,
    ["a", "b", "c"],
    new Set([inner]),
    { id: outer, title: "Outer", memberNodeIds: [] },
  );
  expect(wrapped.ok).toBe(true);
  if (wrapped.ok === false) return;
  expect(wrapped.document.clusters).toEqual(
    expect.arrayContaining([
      {
        id: inner,
        title: "Inner",
        memberNodeIds: ["a", "b"],
        parentClusterId: outer,
      },
    ]),
  );
  expect(
    wrapped.document.clusters.find((c) => c.id === outer)?.memberNodeIds,
  ).toEqual(["c"]);
});
it("promotes ownership on dissolve and prunes only effective-empty containers", () => {
  const dissolved = dissolveClusterInDocument(document(), inner).document;
  expect(dissolved.clusters).toHaveLength(1);
  expect(dissolved.clusters[0].memberNodeIds).toEqual(["a", "b", "c"]);
  const rootDissolved = dissolveClusterInDocument(document(), outer).document;
  expect(rootDissolved.clusters[0].parentClusterId).toBeUndefined();
  const deleted = deleteNodesFromDocument(document(), new Set(["c"])).document;
  expect(deleted.clusters).toHaveLength(2);
  expect(deleted.clusters.find((c) => c.id === outer)?.memberNodeIds).toEqual(
    [],
  );
  expect(
    deleteNodesFromDocument(document(), new Set(["a", "b", "c"])).document
      .clusters,
  ).toEqual([]);
});
it("pastes entire subtrees, remaps parents, and rejects depth overflow without mutation", () => {
  const copied = {
    nodes: nodes.map((n) => ({ ...n, id: n.id + "2" })),
    edges: edges.map((e) => ({
      ...e,
      id: e.id + "2",
      source: e.source + "2",
      target: e.target + "2",
    })),
    idMap: { a: "a2", b: "b2", c: "c2" },
    copiedClusters: clusters,
  };
  const pasted = pasteNodesInDocument(
    { nodes: [], edges: [], clusters: [] },
    copied,
  );
  expect(pasted.ok).toBe(true);
  if (pasted.ok === false) return;
  const parent = pasted.document.clusters.find((c) => c.title === "Outer")!;
  expect(
    pasted.document.clusters.find((c) => c.title === "Inner")?.parentClusterId,
  ).toBe(parent.id);
  expect(parent.memberNodeIds).toEqual(["c2"]);
  expect(
    pasteNodesInDocument(document(), {
      ...copied,
      targetClusterId: outer,
      expandedClusterId: inner,
    }).ok,
  ).toBe(false);
  expect(document().clusters).toEqual(clusters);
});
it("projects the first collapsed ancestor and retains one runtime host per leaf", () => {
  const root = projectClusterGraph(nodes, edges, clusters, {}, () => {});
  expect([...root.displayNodeToCluster.values()]).toEqual([outer]);
  expect(root.nodes.filter((n) => n.id === "a")).toHaveLength(1);
  const view = focusedClusterToViewState(outer, clusters);
  const inside = projectClusterGraph(nodes, edges, clusters, view, () => {}, {
    focusedClusterId: outer,
  });
  expect([...inside.displayNodeToCluster.values()]).toEqual([inner]);
  expect(inside.edges.find((e) => e.id === "bc")?.data).toMatchObject({
    canonicalSource: "b",
    canonicalTarget: "c",
  });
  const effects = applyClusterExecutionVisuals(
    inside.nodes,
    inside.edges,
    nodes,
    edges,
    clusters,
    { clusterId: outer, nodeId: "b", sessionId: "s" },
    true,
    inside.displayEdgeToCanonicalEdge,
  );
  expect(effects.edges.find((e) => e.id === "bc")?.animated).toBe(true);
  expect(
    effects.nodes.find((n) => n.type === "compactCluster")?.data.isExecuting,
  ).toBe(true);
  expect(closeFocusedCluster(inner, clusters)).toBe(outer);
  expect(focusedClusterToViewState(inner, clusters)).toEqual({
    [outer]: true,
    [inner]: true,
  });
  const both = projectClusterGraph(
    nodes,
    edges,
    clusters,
    focusedClusterToViewState(inner, clusters),
    () => {},
    { focusedClusterId: inner },
  );
  expect(both.hiddenRuntimeHostIds.size).toBe(0);
});
it("inserts into either expanded body while inner is focused and executes effective leaves", () => {
  expect(
    insertNodesInDocument(document(), {
      nodes: [node("new")],
      targetClusterId: outer,
      expandedClusterId: inner,
    }).ok,
  ).toBe(true);
  const view = focusedClusterToViewState(inner, clusters);
  expect(
    getExpandedClusterFrameRect(
      { ...clusters[1], memberNodeIds: [] },
      nodes,
      clusters,
      view,
    ),
  ).not.toBeNull();
  const point = { x: 120, y: 120 };
  expect(
    resolveInsertionPosition({
      intent: {
        position: point,
        source: "canvas-pointer",
        workflowSessionId: "s",
      },
      fallbackPosition: point,
      nodes,
      clusters,
      expandedClusterId: inner,
      workflowSessionId: "s",
      zoom: 1,
    }).targetClusterId,
  ).toBe(inner);
  expect(
    buildClusterExecutionPlan(clusters[1], nodes, edges, clusters)
      .executableNodeIds,
  ).toEqual(["a", "b", "c"]);
});
