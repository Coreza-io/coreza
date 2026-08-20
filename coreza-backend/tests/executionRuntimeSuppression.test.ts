import { DataContext } from "../src/engine/DataContext";
import {
  BacktestExecutionRuntime,
  StandardExecutionRuntime,
  type RuntimeOptions,
} from "../src/engine/executionRuntime";
import { GraphRuntime } from "../src/engine/graphRuntime";
import { IndicatorStateManager } from "../src/engine/indicatorStateManager";
import { NodeStoreV2 } from "../src/engine/nodeStoreV2";
import { ParameterResolver } from "../src/engine/parameterResolver";
import type { NodeResult, WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const nodes: WorkflowNode[] = [
  { id: "source", name: "Source", node_type: "main", category: "Test" },
  { id: "target", name: "Target", node_type: "main", category: "Test" },
];
const edges: WorkflowEdge[] = [{ id: "edge", source: "source", target: "target" }];

function dependencies() {
  const options: RuntimeOptions = {
    executionId: "execution",
    workflowId: "workflow",
    userId: "user",
    mode: "fail-fast",
    executionMode: "backtest",
    nodes,
    edges,
    nodeExecutorMap: new Map(),
    dataContext: new DataContext({ executionId: "execution", workflowId: "workflow", userId: "user" }),
    indicatorStateManager: new IndicatorStateManager(),
  };
  return {
    graph: new GraphRuntime(nodes, edges),
    store: new NodeStoreV2("execution", nodes, "user", "workflow"),
    resolver: new ParameterResolver(nodes),
    options,
  };
}

class TestStandardRuntime extends StandardExecutionRuntime {
  route(result: NodeResult): void {
    this.routeNodeResult(nodes[0], result, performance.now());
  }
}

class TestBacktestRuntime extends BacktestExecutionRuntime {
  route(result: NodeResult): void {
    this.routeNodeResult(nodes[0], result, performance.now());
  }
}

describe.each([
  ["standard queue", TestStandardRuntime],
  ["backtest queue", TestBacktestRuntime],
])("%s downstream suppression", (_name, Runtime) => {
  it.each([
    [true, false],
    [false, true],
  ])("suppressDownstream=%s leaves pending=%s", (suppressed, expectedPending) => {
    const { graph, store, resolver, options } = dependencies();
    const runtime = new Runtime(graph, store, resolver, options);
    runtime.route({ success: true, data: {}, control: { suppressDownstream: suppressed } });
    expect(runtime.hasPending()).toBe(expectedPending);
  });
});
