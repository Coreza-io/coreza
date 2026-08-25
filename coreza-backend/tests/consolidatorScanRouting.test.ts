import type { INodeExecutor, WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const mockExecutedNodeIds: string[] = [];
const mockDownstreamInputs: unknown[] = [];
let mockFailureSymbol: string | undefined;
const mockDownstreamExecutor: INodeExecutor = {
  category: "test",
  syncCapable: true,
  execute: (node, input) => {
    mockExecutedNodeIds.push(node.id);
    mockDownstreamInputs.push(input);
    const inputSymbol = typeof input === "object" && input !== null && "symbol" in input
      ? input.symbol
      : undefined;
    if (inputSymbol === mockFailureSymbol) {
      return { success: false, data: null, error: "injected failure" };
    }
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
  beforeEach(() => {
    mockExecutedNodeIds.splice(0);
    mockDownstreamInputs.splice(0);
    mockFailureSymbol = undefined;
  });

  it("warns when a clock-scanned consolidator participates in a mixed join", () => {
    const previous = process.env.ENABLE_CONSOLIDATOR_SCAN;
    process.env.ENABLE_CONSOLIDATOR_SCAN = "true";
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      WorkflowPlan.compile([
        nodes[0],
        { id: "bar", name: "OnBar", node_type: "main", category: "Data", values: {} },
        nodes[2],
      ], [
        edges[0],
        { id: "bar-join", source: "bar", target: "join" },
      ], "manual");
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("Mixed consolidator join"));
    } finally {
      warning.mockRestore();
      if (previous === undefined) delete process.env.ENABLE_CONSOLIDATOR_SCAN;
      else process.env.ENABLE_CONSOLIDATOR_SCAN = previous;
    }
  });

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
      bar: { timestamp: "2026-01-01T00:00:00Z", endTimestamp: "2026-01-01T04:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      workingBar: null,
      emissionReason: "time_scan" as const,
      emittedAt: "2026-01-01T04:00:00Z",
      symbol: "SPY",
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
    };

    const result = await run.executeInjectedResults([
      { nodeId: "scan-a", emissionId: "run:scan-a:SPY:end", payload },
      { nodeId: "scan-b", emissionId: "run:scan-b:SPY:end", payload },
    ]);

    expect(result.success).toBe(true);
    expect(mockExecutedNodeIds).toEqual(["join"]);
    expect(result.executionOrder).toEqual(["scan-a", "scan-b", "join"]);
    expect(result.nodeResults).toMatchObject({
      "scan-a": { data: { bar: { open: 1 } } },
      "scan-b": { data: { symbol: "SPY" } },
      join: { data: { nodeId: "join" } },
    });
    run.destroy();
  });

  it("runs distinct symbol passes when one consolidator node emits twice", async () => {
    const singleNodes = [nodes[0], nodes[2]];
    const run = WorkflowPlan.compile(singleNodes, [edges[0]], "manual").createRun({
      executionId: "injected-symbol-routing",
      workflowId: "workflow",
      userId: "user",
      executionMode: "manual",
      flushPolicy: "never",
    });
    const payload = {
      emitted: true,
      bar: { timestamp: "2026-01-01T00:00:00Z", endTimestamp: "2026-01-01T04:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      workingBar: null,
      emissionReason: "time_scan" as const,
      emittedAt: "2026-01-01T04:00:00Z",
      symbol: "SPY",
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
    };

    const result = await run.executeInjectedResults([
      { nodeId: "scan-a", emissionId: "run:scan-a:SPY:end", payload },
      {
        nodeId: "scan-a",
        emissionId: "run:scan-a:QQQ:end",
        payload: { ...payload, symbol: "QQQ", bar: { ...payload.bar, open: 2 } },
      },
    ]);

    expect(result.success).toBe(true);
    expect(mockExecutedNodeIds).toEqual(["join", "join"]);
    expect(mockDownstreamInputs).toEqual([
      expect.objectContaining({ symbol: "SPY", bar: expect.objectContaining({ open: 1 }) }),
      expect.objectContaining({ symbol: "QQQ", bar: expect.objectContaining({ open: 2 }) }),
    ]);
    run.destroy();
  });

  it("separates one symbol into ascending logical-clock passes", async () => {
    const clockNodes: WorkflowNode[] = [
      nodes[0], nodes[1],
      { id: "after-4h", name: "Compute", node_type: "main", category: "Data", values: {} },
      { id: "after-1d", name: "Compute", node_type: "main", category: "Data", values: {} },
    ];
    const run = WorkflowPlan.compile(clockNodes, [
      { id: "4h-downstream", source: "scan-a", target: "after-4h" },
      { id: "1d-downstream", source: "scan-b", target: "after-1d" },
    ], "manual").createRun({
      executionId: "injected-clock-routing", workflowId: "workflow", userId: "user",
      executionMode: "manual", flushPolicy: "never",
    });
    const bar = { timestamp: "2026-01-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1 };
    const payload = {
      emitted: true, workingBar: null, emissionReason: "time_scan" as const,
      emittedAt: "2026-01-02T00:00:00Z", symbol: "SPY", sourceTimeframe: "1h", targetTimeframe: "4h",
    };

    const result = await run.executeInjectedResults([
      { nodeId: "scan-b", emissionId: "daily", payload: { ...payload, targetTimeframe: "1d", bar: { ...bar, endTimestamp: "2026-01-02T00:00:00Z" } } },
      { nodeId: "scan-a", emissionId: "four-hour", payload: { ...payload, bar: { ...bar, endTimestamp: "2026-01-01T16:00:00Z" } } },
    ]);

    expect(result.success).toBe(true);
    expect(result.executionOrder).toEqual(["scan-a", "after-4h", "scan-b", "after-1d"]);
    expect(result.nodeResults).toMatchObject({ "after-4h": { success: true }, "after-1d": { success: true } });
    expect(result.executionBatches).toMatchObject([
      { endTimestamp: "2026-01-01T16:00:00Z", emissionIds: ["four-hour"] },
      { endTimestamp: "2026-01-02T00:00:00Z", emissionIds: ["daily"] },
    ]);
    run.destroy();
  });

  it("reports only successfully delivered symbol batches to the commit callback", async () => {
    const run = WorkflowPlan.compile([nodes[0], nodes[2]], [edges[0]], "manual").createRun({
      executionId: "injected-retry-routing", workflowId: "workflow", userId: "user",
      executionMode: "manual", flushPolicy: "never",
    });
    const payload = {
      emitted: true,
      bar: { timestamp: "2026-01-01T00:00:00Z", endTimestamp: "2026-01-01T04:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      workingBar: null, emissionReason: "time_scan" as const,
      emittedAt: "2026-01-01T04:00:00Z", symbol: "SPY", sourceTimeframe: "1h", targetTimeframe: "4h",
    };
    const committed: string[] = [];
    mockFailureSymbol = "QQQ";

    const result = await run.executeInjectedResults([
      { nodeId: "scan-a", emissionId: "run:scan-a:SPY:end", payload },
      { nodeId: "scan-a", emissionId: "run:scan-a:QQQ:end", payload: { ...payload, symbol: "QQQ" } },
    ], (batch) => {
      committed.push(...batch.map((emission) => emission.emissionId));
    });

    expect(result.success).toBe(false);
    expect(committed).toEqual(["run:scan-a:SPY:end"]);
    run.destroy();
  });
});
