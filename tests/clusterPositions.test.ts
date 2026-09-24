import type { Node } from "@xyflow/react";
import {
  applyPositionTargets,
  capturePositions,
  positionsEqual,
  translatePositions,
} from "@/domain/clusters/positions";

describe("cluster position commands", () => {
  const nodes: Node[] = [
    { id: "a", position: { x: 10, y: 20 }, data: { output: "latest" }, selected: true },
    { id: "b", position: { x: 40, y: 80 }, data: { configuration: { period: 5 } } },
    { id: "other", position: { x: 0, y: 0 }, data: {} },
  ];

  it("captures unique targets and translates them without changing spacing", () => {
    const before = capturePositions(nodes, ["a", "a", "b", "missing"]);
    const after = translatePositions(before, { x: 7, y: -3 });
    expect([...after]).toEqual([
      ["a", { x: 17, y: 17 }],
      ["b", { x: 47, y: 77 }],
    ]);
    expect(after.get("b")!.x - after.get("a")!.x).toBe(30);
  });

  it("applies only positions to the latest node objects", () => {
    const latest = nodes.map((node) => node.id === "a"
      ? { ...node, data: { output: "arrived during drag" }, measured: { width: 300, height: 200 } }
      : node);
    const result = applyPositionTargets(latest, new Map([["a", { x: 99, y: 101 }]]));
    expect(result[0]).toMatchObject({
      position: { x: 99, y: 101 },
      data: { output: "arrived during drag" },
      measured: { width: 300, height: 200 },
      selected: true,
    });
    expect(result[1]).toBe(latest[1]);
    expect(result[2]).toBe(latest[2]);
  });

  it("compares position maps exactly", () => {
    const before = capturePositions(nodes, ["a", "b"]);
    expect(positionsEqual(before, translatePositions(before, { x: 0, y: 0 }))).toBe(true);
    expect(positionsEqual(before, translatePositions(before, { x: 0.01, y: 0 }))).toBe(false);
  });
});
