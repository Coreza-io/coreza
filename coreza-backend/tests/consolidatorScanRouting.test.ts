import type { INodeExecutor, WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const mockExecutedNodeIds: string[] = [];
const mockDownstreamExecutor: INodeExecutor = {
  category: "test",
  syncCapable: true,
  execute: (node) => {
    mockExecutedNodeIds.push(node.id);
    return { success: true, data: { nodeId: node.id } };
  },
};

jest.mock("../src/nodes/registry", () => ({
  getNodeExecutor: () => mockDownstreamExecutor,
}));

import { WorkflowPlan } from "../src/engine/workflowPlan";

const nodes: WorkflowNode[] = [
  { id: "scan-a", name: "Consolidator", node_type: "main", category: "Data", values: {} },
  { id: "scan-b", name: "Consolidator", node_type: "main", category: "Data", values: {} },
  { id: "join", name: "Join", node_type: "main", category: "Data", values: {} },
];
const edges: WorkflowEdge[] = [
  { id: "a-join", source: "scan-a", target: "join" },
  { id: "b-join", source: "scan-b", target: "join" },
];

describe("consolidator scan routing", () => {
  beforeEach(() => mockExecutedNodeIds.splice(0));

  it("injects every same-clock result before evaluating a multi-parent join", async () => {
    const run = WorkflowPlan.compile(nodes, edges, "manual").createRun({
      executionId: "injected-routing",
      workflowId: "workflow",
      userId: "user",
      executionMode: "manual",
      flushPolicy: "never",
    });
    const payload = {
      emitted: true,
      bar: { timestamp: "2026-01-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      workingBar: null,
      emissionReason: "time_scan" as const,
      emittedAt: "2026-01-01T04:00:00Z",
      symbol: "SPY",
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
    };

    const result = await run.executeInjectedResults([
      { nodeId: "scan-a", payload },
      { nodeId: "scan-b", payload: { ...payload, symbol: "QQQ" } },
    ]);

    expect(result.success).toBe(true);
    expect(mockExecutedNodeIds).toEqual(["join"]);
    expect(result.executionOrder).toEqual(["scan-a", "scan-b", "join"]);
    expect(result.nodeResults).toMatchObject({
      "scan-a": { data: { bar: { open: 1 } } },
      "scan-b": { data: { symbol: "QQQ" } },
      join: { data: { nodeId: "join" } },
    });
    run.destroy();
  });
});
