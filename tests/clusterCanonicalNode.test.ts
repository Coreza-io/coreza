import type { Node } from "@xyflow/react";
import { filterCanonicalNodeChanges, repairProjectedClusterNode } from "@/domain/clusters/canonicalNode";

describe("cluster canonical node repair", () => {
  it("removes only collapsed projection decorations", () => {
    const node: Node = {
      id: "member",
      position: { x: 10, y: 20 },
      className: "custom cluster-runtime-host cluster-runtime-host",
      style: { color: "red", visibility: "hidden", pointerEvents: "none", transition: "none", animation: "none" },
      domAttributes: { title: "kept", "aria-hidden": true },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      data: { values: { amount: 4 }, output: { ok: true } },
    };
    expect(repairProjectedClusterNode(node)).toEqual({
      ...node,
      className: "custom",
      style: { color: "red" },
      domAttributes: { title: "kept" },
      draggable: undefined,
      selectable: undefined,
      connectable: undefined,
      deletable: undefined,
      focusable: undefined,
    });
  });

  it("does not normalize intentionally hidden nodes without the reserved marker", () => {
    const node: Node = { id: "hidden", position: { x: 0, y: 0 }, style: { visibility: "hidden" }, data: {} };
    expect(repairProjectedClusterNode(node)).toBe(node);
  });

  it("rejects projected replacements and synthetic display-node changes", () => {
    const projected = {
      id: "member",
      position: { x: 0, y: 0 },
      className: "cluster-runtime-host",
      data: {},
    } satisfies Node;
    expect(filterCanonicalNodeChanges([
      { type: "replace", id: "member", item: projected },
      { type: "position", id: "member", position: { x: 4, y: 8 } },
      { type: "select", id: "__coreza_cluster_display__:folder", selected: true },
    ], new Set(["member"]))).toEqual([
      { type: "position", id: "member", position: { x: 4, y: 8 } },
    ]);
  });
});