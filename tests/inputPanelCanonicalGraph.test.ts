import type { Edge, Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { resolveLiveInputData, resolvePreviousNodeId } from "@/utils/inputPanelSelection";
import { createJsonReferenceDragPayload } from "@/utils/referencePath";

const nodes: Node[] = ["init", "bar", "outside", "unrelated"].map((id) => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
}));
const canonicalEdges: Edge[] = [
  { id: "internal", source: "init", target: "bar" },
  { id: "boundary", source: "bar", target: "outside" },
];

describe("InputPanel canonical graph semantics", () => {
  it("retains all and only canonical ancestors when display projection omits internal edges", () => {
    expect(getAllUpstreamNodes("outside", canonicalEdges, nodes).map(({ id }) => id))
      .toEqual(["bar", "init"]);

    const projectedEdges: Edge[] = [
      { id: "boundary", source: "__cluster__:strategy", target: "outside" },
    ];
    expect(getAllUpstreamNodes("outside", projectedEdges, nodes)).toEqual([]);
  });

  it("deduplicates ancestors across multiple collapsed-cluster boundaries", () => {
    const graphNodes: Node[] = ["root", "left", "right", "join", "outside", "unrelated"].map((id) => ({
      id, position: { x: 0, y: 0 }, data: {},
    }));
    const graphEdges: Edge[] = [
      { id: "root-left", source: "root", target: "left" },
      { id: "root-right", source: "root", target: "right" },
      { id: "left-join", source: "left", target: "join" },
      { id: "right-join", source: "right", target: "join" },
      { id: "join-outside", source: "join", target: "outside" },
    ];
    const ids = getAllUpstreamNodes("outside", graphEdges, graphNodes).map(({ id }) => id);
    expect(ids).toEqual(["join", "left", "right", "root"]);
    expect(ids).not.toContain("unrelated");
  });

  it("preserves valid selections and deterministically repairs stale display IDs", () => {
    const previous = getAllUpstreamNodes("outside", canonicalEdges, nodes);
    expect(resolvePreviousNodeId("init", previous, "bar")).toBe("init");
    expect(resolvePreviousNodeId("__cluster__:strategy", previous, "bar")).toBe("bar");
    expect(resolvePreviousNodeId("deleted", previous)).toBe("bar");
    expect(resolvePreviousNodeId("deleted", [])).toBeUndefined();
  });

  it.each([0, false, "", null, [], {}])("keeps an owned execution output authoritative: %#", (output) => {
    const source: Node = {
      id: "source",
      position: { x: 0, y: 0 },
      data: { output: "stale-node-output", input: "stale-node-input" },
    };
    expect(resolveLiveInputData("source", [source], () => ({ output }))).toBe(output);
  });

  it("falls back by property presence rather than truthiness", () => {
    const withNullOutput: Node = {
      id: "source",
      position: { x: 0, y: 0 },
      data: { output: null, input: "stale" },
    };
    expect(resolveLiveInputData("source", [withNullOutput], () => ({}))).toBeNull();
    expect(resolveLiveInputData("source", [{ ...withNullOutput, data: { input: false } }], () => ({}))).toBe(false);
  });

  it("keeps canonical nested-array drag provenance through repeated presentation toggles", () => {
    const previous = getAllUpstreamNodes("outside", canonicalEdges, nodes);
    let selected = "bar";
    for (let cycle = 0; cycle < 20; cycle += 1) {
      selected = resolvePreviousNodeId(selected, previous) ?? "";
      expect(createJsonReferenceDragPayload(["data", 0, "close"], selected, "42"))
        .toMatchObject({ sourceNodeId: "bar", keyPath: "data[0].close" });
    }
  });
});
