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
});
