import type { Edge, Node } from "@xyflow/react";
import { NodeConfigSchema } from "../../src/nodes/schemas/nodeSchema";
import {
  BACKTEST_INIT_NODE_TYPE,
  ON_BAR_NODE_TYPE,
  createPaletteNodeBatch,
} from "../../src/domain/clusters/paletteNodeBatch";

const definition = (name: string, nodeType: "main" | "backtest" = "main") => NodeConfigSchema.parse({
  name,
  node_type: nodeType,
  handles: [{ id: "input", type: "target", position: "left" }],
  fields: [],
});

describe("palette node batch factory", () => {
  it("allocates deterministic collision-safe node IDs", () => {
    const existingNodes: Node[] = [
      { id: "Store", type: "Store", position: { x: 0, y: 0 }, data: {} },
      { id: "Store1", type: "Store", position: { x: 0, y: 0 }, data: {} },
    ];
    const batch = createPaletteNodeBatch({
      nodeType: "Store",
      definition: definition("Store"),
      position: { x: 20, y: 30 },
      workflowSessionId: "session",
      existingNodes,
      existingEdges: [],
      onRemoveEdge: jest.fn(),
    });
    expect(batch.primaryNodeId).toBe("Store2");
    expect(batch.nodes[0]).toMatchObject({ id: "Store2", position: { x: 20, y: 30 } });
    expect(existingNodes).toHaveLength(2);
  });

  it("builds the BacktestInit companion and edge as one collision-safe batch", () => {
    const removeEdge = jest.fn();
    const existingEdges: Edge[] = [{ id: "edge_BacktestInit_OnBar", source: "a", target: "b" }];
    const batch = createPaletteNodeBatch({
      nodeType: BACKTEST_INIT_NODE_TYPE,
      definition: definition(BACKTEST_INIT_NODE_TYPE, "backtest"),
      onBarDefinition: definition(ON_BAR_NODE_TYPE),
      position: { x: 100, y: 200 },
      workflowSessionId: "session",
      existingNodes: [],
      existingEdges,
      onRemoveEdge: removeEdge,
    });
    expect(batch.nodes.map(({ id }) => id)).toEqual([BACKTEST_INIT_NODE_TYPE, ON_BAR_NODE_TYPE]);
    expect(batch.nodes[1].position).toEqual({ x: 550, y: 200 });
    expect(batch.edges[0]).toMatchObject({
      id: "edge_BacktestInit_OnBar1",
      source: BACKTEST_INIT_NODE_TYPE,
      target: ON_BAR_NODE_TYPE,
      sourceHandle: "output",
      targetHandle: "input",
    });
    const callback = batch.edges[0].data?.onRemoveEdge;
    expect(typeof callback).toBe("function");
    if (typeof callback === "function") callback();
    expect(removeEdge).toHaveBeenCalledWith("edge_BacktestInit_OnBar1");
    expect(existingEdges).toHaveLength(1);
  });
});
