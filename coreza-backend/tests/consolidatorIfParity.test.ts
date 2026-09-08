import { compilePlan } from "../src/backtest/compiled/compiler";
import { runBar } from "../src/backtest/compiled/vm";
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
import { ConsolidatorExecutor } from "../src/nodes/executors/ConsolidatorExecutor";
import type { INodeExecutor, WorkflowEdge, WorkflowNode } from "../src/nodes/types";
import { preCompileAllNodes } from "../src/utils/templateCompiler";

const SOURCE_ID = "source";
const CONSOLIDATOR_ID = "consolidator";
const IF_ID = "if";
const SINK_ID = "sink";

const nodes: WorkflowNode[] = [
  { id: SOURCE_ID, name: "Source", node_type: "main", category: "Test" },
  {
    id: CONSOLIDATOR_ID,
    name: "Consolidator",
    node_type: "main",
    category: "Data",
    values: {
      candle_data: `{{ $('${SOURCE_ID}').json.data.candle_data }}`,
      symbol: "SPY",
      source_timeframe: "1h",
      target_timeframe: "4h",
    },
  },
  {
    id: IF_ID,
    name: "If",
    node_type: "main",
    category: "Logic",
    values: {
      conditions: [
        {
          left: `{{ $('${CONSOLIDATOR_ID}').json.data.emitted }}`,
          operator: "===",
          right: true,
          dataType: "boolean",
        },
      ],
    },
  },
  { id: SINK_ID, name: "Sink", node_type: "main", category: "Test" },
];

const edges: WorkflowEdge[] = [
  { id: "source-consolidator", source: SOURCE_ID, target: CONSOLIDATOR_ID },
  { id: "consolidator-if", source: CONSOLIDATOR_ID, target: IF_ID },
  { id: "if-sink", source: IF_ID, target: SINK_ID, sourceHandle: "true" },
];

const bars = Array.from({ length: 9 }, (_, hour) => ({
  candle_data: {
    timestamp: `2026-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
    open: hour,
    high: hour,
    low: hour,
    close: hour,
    volume: 1,
  },
}));

function createExecutors(onSink: () => void): Map<string, INodeExecutor> {
  return new Map<string, INodeExecutor>([
    [
      SOURCE_ID,
      {
        category: "Test",
        syncCapable: true,
        execute: (_node, input) => ({ success: true, data: input }),
      },
    ],
    [CONSOLIDATOR_ID, new ConsolidatorExecutor()],
    [
      IF_ID,
      {
        category: "ControlFlow",
        syncCapable: true,
        execute: (node, input, context) => {
          const params =
            context?.resolveNodeParameters(node, input) ?? node.values;
          return { success: true, data: params?.conditions?.[0]?.left === true };
        },
      },
    ],
    [
      SINK_ID,
      {
        category: "Test",
        syncCapable: true,
        execute: () => {
          onSink();
          return { success: true, data: {} };
        },
      },
    ],
  ]);
}

function createDataContext(executionId: string): DataContext {
  return new DataContext({ executionId, workflowId: "workflow", userId: "user" });
}

async function queueActivations(
  Runtime: typeof StandardExecutionRuntime | typeof BacktestExecutionRuntime,
): Promise<number[]> {
  let activationCount = 0;
  const executionId = Runtime.name;
  const dataContext = createDataContext(executionId);
  const executors = createExecutors(() => {
    activationCount += 1;
  });
  const options: RuntimeOptions = {
    executionId,
    workflowId: "workflow",
    userId: "user",
    mode: "fail-fast",
    executionMode: "backtest",
    nodes,
    edges,
    nodeExecutorMap: executors,
    dataContext,
    indicatorStateManager: new IndicatorStateManager(),
  };
  const runtime = new Runtime(
    new GraphRuntime(nodes, edges),
    new NodeStoreV2(executionId, nodes, "user", "workflow"),
    new ParameterResolver(nodes),
    options,
  );

  const counts: number[] = [];
  for (const bar of bars) {
    runtime.resetForNextBar();
    runtime.enqueue({ nodeId: SOURCE_ID, input: bar });
    while (runtime.hasPending()) {
      const item = runtime.dequeue();
      if (item) await runtime.executeOnce(item);
    }
    counts.push(activationCount);
  }
  return counts;
}

async function compiledActivations(): Promise<number[]> {
  let activationCount = 0;
  const dataContext = createDataContext("compiled");
  const graph = new GraphRuntime(nodes, edges);
  const plan = compilePlan(
    graph,
    createExecutors(() => {
      activationCount += 1;
    }),
    [SOURCE_ID],
    preCompileAllNodes(nodes),
    {},
    {
      runId: "compiled",
      workflowId: "workflow",
      userId: "user",
      nodes,
      edges,
      dataContext,
      indicatorStateManager: new IndicatorStateManager(),
      storeGetState: () => undefined,
      storeSetState: () => undefined,
    },
  );
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected the parity workflow to compile");

  const counts: number[] = [];
  for (const bar of bars) {
    await runBar(plan, bar);
    counts.push(activationCount);
  }
  return counts;
}

describe("Consolidator explicit If parity", () => {
  it("produces identical completed-bar sink activations in every engine", async () => {
    const [standard, backtest, compiled] = await Promise.all([
      queueActivations(StandardExecutionRuntime),
      queueActivations(BacktestExecutionRuntime),
      compiledActivations(),
    ]);

    expect(standard).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2]);
    expect(backtest).toEqual(standard);
    expect(compiled).toEqual(standard);
  });
});
