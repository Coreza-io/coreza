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
});
