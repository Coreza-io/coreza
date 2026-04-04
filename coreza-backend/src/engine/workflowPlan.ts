import { INodeExecutor, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { resolveCategory } from "../nodes/categoryMap";
import { getNodeExecutor } from "../nodes/registry";
import { GraphRuntime } from "./graphRuntime";
import { ParameterResolver } from "./parameterResolver";
import { ExecutionMode, FlushPolicy } from "./types";
import { WorkflowRun } from "./workflowRun";

export class WorkflowPlan {
  readonly graph: GraphRuntime;
  readonly resolver: ParameterResolver;
  readonly entryNodeIds: readonly string[];
  readonly executionMode: ExecutionMode;
  readonly nodeExecutorMap: ReadonlyMap<string, INodeExecutor>;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];

  private constructor(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    executionMode: ExecutionMode,
    graph: GraphRuntime,
    resolver: ParameterResolver,
    executorMap: Map<string, INodeExecutor>,
  ) {
    this.nodes = Object.freeze([...nodes]);
    this.edges = Object.freeze([...edges]);
    this.executionMode = executionMode;
    this.graph = graph;
    this.resolver = resolver;
    this.entryNodeIds = graph.entryNodeIds;
    this.nodeExecutorMap = executorMap;
  }

  static compile(nodes: WorkflowNode[], edges: WorkflowEdge[], executionMode: ExecutionMode): WorkflowPlan {
    const graph = new GraphRuntime(nodes, edges);
    const resolver = new ParameterResolver(nodes);

    const executorMap = new Map<string, INodeExecutor>();
    for (const node of nodes) {
      const exec = getNodeExecutor(resolveCategory(node));
      if (exec) executorMap.set(node.id, exec);
    }

    return new WorkflowPlan(nodes, edges, executionMode, graph, resolver, executorMap);
  }

  get isBacktest(): boolean {
    return this.executionMode === "backtest";
  }

  createRun(opts: {
    runId: string;
    workflowId: string;
    userId: string;
    mode?: "best-effort" | "fail-fast";
    abortSignal?: AbortSignal;
    flushPolicy?: FlushPolicy;
    executionMode: ExecutionMode;
  }): WorkflowRun {
    return new WorkflowRun(this, opts);
  }
}
