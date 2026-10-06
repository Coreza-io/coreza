import type { Edge, Node } from "@xyflow/react";
import { createCanonicalGraphStore } from "@/contexts/canonicalGraphStore";

describe("canonical graph store", () => {
  const nodes: Node[] = [{ id: "source", position: { x: 0, y: 0 }, data: {} }];
  const edges: Edge[] = [];

  it("publishes committed documents and preserves unchanged snapshot identity", () => {
    const store = createCanonicalGraphStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.publish(nodes, edges);
    const first = store.getSnapshot();
    store.publish(nodes, edges);

    expect(store.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    const replacement = nodes.map((node) => ({ ...node, data: { label: "updated" } }));
    store.publish(replacement, edges);
    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot().nodes).toBe(replacement);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps semantic identity stable for geometry and presentation-only updates", () => {
    const store = createCanonicalGraphStore();
    const fullListener = jest.fn();
    const semanticListener = jest.fn();
    store.subscribe(fullListener);
    store.subscribeSemantic(semanticListener);
    store.publish(nodes, edges, "session");
    const semantic = store.getSemanticSnapshot();

    const moved: Node[] = nodes.map((node) => ({
      ...node,
      position: { x: 40, y: 80 },
      measured: { width: 300, height: 200 },
      selected: true,
      dragging: true,
      style: { visibility: "hidden" },
    }));
    store.publish(moved, edges, "session");

    expect(store.getSnapshot().nodes).toBe(moved);
    expect(store.getSemanticSnapshot()).toBe(semantic);
    expect(fullListener).toHaveBeenCalledTimes(2);
    expect(semanticListener).toHaveBeenCalledTimes(1);
  });

  it("notifies semantic consumers for same-count node and edge changes", () => {
    const store = createCanonicalGraphStore();
    const semanticListener = jest.fn();
    const connectedEdges: Edge[] = [{ id: "edge", source: "source", target: "target", sourceHandle: "out" }];
    const graphNodes: Node[] = [
      ...nodes,
      { id: "target", position: { x: 100, y: 0 }, data: {} },
      { id: "other", position: { x: 200, y: 0 }, data: {} },
    ];
    store.subscribeSemantic(semanticListener);
    store.publish(graphNodes, connectedEdges, "session");
    const first = store.getSemanticSnapshot();

    const changedData = graphNodes.map((node) => node.id === "source"
      ? { ...node, data: { ...node.data, output: 0 } }
      : node);
    store.publish(changedData, connectedEdges, "session");
    expect(store.getSemanticSnapshot()).not.toBe(first);

    const reconnected = [{ ...connectedEdges[0], target: "other", sourceHandle: "done" }];
    store.publish(changedData, reconnected, "session");
    expect(semanticListener).toHaveBeenCalledTimes(3);
    expect(store.getSemanticSnapshot().getUpstreamNodes("other").map(({ id }) => id)).toEqual(["source"]);
  });

  it.each([
    ["display name", { displayName: "Renamed" }],
    ["values", { values: { period: 20 } }],
    ["field state", { fieldState: { period: 20 } }],
    ["output", { output: false }],
    ["pinned output", { pinnedOutput: null }],
    ["workflow session", { workflowSessionId: "replacement" }],
  ])("publishes a semantic update for %s data", (_label, patch) => {
    const store = createCanonicalGraphStore();
    const listener = jest.fn();
    store.subscribeSemantic(listener);
    store.publish(nodes, edges, "session");
    store.publish([{ ...nodes[0], data: { ...nodes[0].data, ...patch } }], edges, "session");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("publishes add, remove, reorder, rename, and type changes without using counts as semantics", () => {
    const store = createCanonicalGraphStore();
    const listener = jest.fn();
    const second: Node = { id: "second", type: "task", position: { x: 1, y: 1 }, data: {} };
    store.subscribeSemantic(listener);
    store.publish([...nodes, second], edges, "session");
    store.publish([second, ...nodes], edges, "session");
    store.publish([{ ...second, id: "renamed" }, ...nodes], edges, "session");
    store.publish([{ ...second, id: "renamed", type: "other" }, ...nodes], edges, "session");
    store.publish(nodes, edges, "session");
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("publishes edge add, remove, reorder, type, and data changes", () => {
    const store = createCanonicalGraphStore();
    const listener = jest.fn();
    const first: Edge = { id: "first", source: "a", target: "b" };
    const second: Edge = { id: "second", source: "b", target: "c" };
    store.subscribeSemantic(listener);
    store.publish(nodes, [first], "session");
    store.publish(nodes, [first, second], "session");
    store.publish(nodes, [second, first], "session");
    store.publish(nodes, [{ ...second, type: "removable" }, first], "session");
    store.publish(nodes, [{ ...second, type: "removable", data: { route: "done" } }, first], "session");
    store.publish(nodes, [first], "session");
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it("rebuilds semantic state on session replacement with otherwise identical records", () => {
    const store = createCanonicalGraphStore();
    store.publish(nodes, edges, "first");
    const first = store.getSemanticSnapshot();
    store.publish(nodes, edges, "second");
    expect(store.getSemanticSnapshot()).not.toBe(first);
  });

  it("detects top-level in-place data mutation without corrupting the prior semantic record", () => {
    const store = createCanonicalGraphStore();
    const mutable: Node[] = [{ id: "source", position: { x: 0, y: 0 }, data: { output: "before" } }];
    store.publish(mutable, edges, "session");
    const before = store.getSemanticSnapshot();
    mutable[0].data.output = "after";
    store.publish([...mutable], edges, "session");
    expect(before.nodes[0].data.output).toBe("before");
    expect(store.getSemanticSnapshot().nodes[0].data.output).toBe("after");
  });

  it("owns independent topology indexes per store", () => {
    const first = createCanonicalGraphStore();
    const second = createCanonicalGraphStore();
    const graphNodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 0, y: 0 }, data: {} },
    ];
    first.publish(graphNodes, [{ id: "ab", source: "a", target: "b" }], "one");
    second.publish(graphNodes, [{ id: "ba", source: "b", target: "a" }], "two");
    expect(first.getSemanticSnapshot().getUpstreamNodes("b").map(({ id }) => id)).toEqual(["a"]);
    expect(second.getSemanticSnapshot().getUpstreamNodes("a").map(({ id }) => id)).toEqual(["b"]);
  });

  it("memoizes deterministic, cycle-safe ancestor results per semantic snapshot", () => {
    const store = createCanonicalGraphStore();
    const graphNodes: Node[] = ["a", "b", "c", "target"].map((id) => ({
      id, position: { x: 0, y: 0 }, data: {},
    }));
    store.publish(graphNodes, [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ca", source: "c", target: "a" },
      { id: "ct", source: "c", target: "target" },
    ], "session");
    const snapshot = store.getSemanticSnapshot();
    const first = snapshot.getUpstreamNodes("target");
    expect(first.map(({ id }) => id)).toEqual(["c", "b", "a"]);
    expect(snapshot.getUpstreamNodes("target")).toBe(first);
  });
});
