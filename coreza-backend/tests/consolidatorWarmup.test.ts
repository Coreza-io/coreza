import { resolveConsolidatorWarmup } from "../src/backtest/warmup/ConsolidatorWarmup";
import type { WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const nodes: WorkflowNode[] = [
  { id: "backtest", name: "BacktestInit", node_type: "backtest", category: "Backtest" },
  {
    id: "consolidator",
    name: "Consolidator",
    node_type: "main",
    category: "Data",
    values: { source_timeframe: "1h", target_timeframe: "4h" },
  },
  { id: "macd", name: "MACD", node_type: "main", category: "Indicators" },
  { id: "unrelated", name: "Consolidator", node_type: "main", category: "Data", values: {} },
];
const edges: WorkflowEdge[] = [
  { id: "one", source: "backtest", target: "consolidator" },
  { id: "two", source: "consolidator", target: "macd" },
];

describe("consolidator warm-up sizing", () => {
  it("uses the indicator's actual requirement, source ratio, and one-bucket cushion", () => {
    expect(resolveConsolidatorWarmup("backtest", nodes, edges, [{
      nodeId: "macd",
      type: "macd",
      params: { slowPeriod: 26, signalPeriod: 9 },
    }])).toEqual({
      requiredSourceBars: (26 + 9) * 4 + 4,
      requiresWorkflowReplay: true,
    });
  });

  it("ignores consolidators outside the backtest strategy subgraph", () => {
    expect(resolveConsolidatorWarmup("backtest", nodes, [], [])).toEqual({
      requiredSourceBars: 0,
      requiresWorkflowReplay: false,
    });
  });

  it("multiplies ratios and applies a bucket cushion at every chained stage", () => {
    const chainedNodes: WorkflowNode[] = [
      nodes[0],
      nodes[1],
      { id: "daily", name: "Consolidator", node_type: "main", category: "Data", values: { source_timeframe: "4h", target_timeframe: "1d" } },
      { id: "sma", name: "SMA", node_type: "main", category: "Indicators" },
    ];
    const chainedEdges: WorkflowEdge[] = [
      edges[0],
      { id: "chain", source: "consolidator", target: "daily" },
      { id: "indicator", source: "daily", target: "sma" },
    ];
    expect(resolveConsolidatorWarmup("backtest", chainedNodes, chainedEdges, [{
      nodeId: "sma", type: "sma", params: { period: 20 },
    }])).toEqual({ requiredSourceBars: (20 * 6 + 6) * 4 + 4, requiresWorkflowReplay: true });
  });

  it("does not apply a consolidator ratio to an independent warm-up branch", () => {
    const branchEdges: WorkflowEdge[] = [
      ...edges,
      { id: "direct", source: "backtest", target: "direct-indicator" },
    ];
    const branchNodes: WorkflowNode[] = [
      ...nodes,
      { id: "direct-indicator", name: "SMA", node_type: "main", category: "Indicators" },
    ];
    expect(resolveConsolidatorWarmup("backtest", branchNodes, branchEdges, [
      { nodeId: "macd", type: "sma", params: { period: 20 } },
      { nodeId: "direct-indicator", type: "sma", params: { period: 100 } },
    ])).toEqual({ requiredSourceBars: 20 * 4 + 4, requiresWorkflowReplay: true });
  });
});
