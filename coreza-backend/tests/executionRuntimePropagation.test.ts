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
import type {
  INodeExecutor,
  NodeResult,
  WorkflowEdge,
  WorkflowNode,
} from "../src/nodes/types";

const nodes: WorkflowNode[] = [
  { id: "source", name: "Source", node_type: "main", category: "Test" },
  { id: "target", name: "Target", node_type: "main", category: "Test" },
];
const edges: WorkflowEdge[] = [{ id: "edge", source: "source", target: "target" }];

function dependencies(result: NodeResult) {
  const executor: INodeExecutor = {
    category: "Test",
    execute: () => result,
  };
  const options: RuntimeOptions = {
    executionId: "execution",
    workflowId: "workflow",
    userId: "user",
    mode: "best-effort",
    executionMode: "backtest",
    nodes,
    edges,
    nodeExecutorMap: new Map([["source", executor]]),
    dataContext: new DataContext({
      executionId: "execution",
      workflowId: "workflow",
      userId: "user",
    }),
    indicatorStateManager: new IndicatorStateManager(),
  };
  return {
    graph: new GraphRuntime(nodes, edges),
    store: new NodeStoreV2("execution", nodes, "user", "workflow"),
    resolver: new ParameterResolver(nodes),
    options,
  };
}

describe.each([
  ["standard queue", StandardExecutionRuntime],
  ["backtest queue", BacktestExecutionRuntime],
])("%s successful-result propagation", (_name, Runtime) => {
  it.each([false, true])(
    "leaves a pending successor when emitted=%s",
    (emitted) => {
      const fixture = dependencies({ success: true, data: { emitted } });
      const runtime = new Runtime(
        fixture.graph,
        fixture.store,
        fixture.resolver,
        fixture.options,
      );

      runtime.executeOnce({ nodeId: "source", input: {} });

      expect(runtime.hasPending()).toBe(true);
    },
  );

  it("does not route a failed result", () => {
    const fixture = dependencies({
      success: false,
      data: null,
      error: "expected failure",
    });
    const runtime = new Runtime(
      fixture.graph,
      fixture.store,
      fixture.resolver,
      fixture.options,
    );

    runtime.executeOnce({ nodeId: "source", input: {} });

    expect(runtime.hasPending()).toBe(false);
    expect(runtime.hasFailures()).toBe(true);
  });
});
