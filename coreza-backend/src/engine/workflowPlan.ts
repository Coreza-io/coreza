import { INodeExecutor, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { resolveCategory } from "../nodes/categoryMap";
import { getNodeExecutor } from "../nodes/registry";
import { GraphRuntime } from "./graphRuntime";
import { ParameterResolver } from "./parameterResolver";
import { ExecutionKind, FlushPolicy } from "./types";
import { WorkflowRun } from "./workflowRun";

export class WorkflowPlan {
  readonly graph: GraphRuntime;
  readonly resolver: ParameterResolver;
  readonly entryNodeIds: readonly string[];
  readonly executionKind: ExecutionKind;
  readonly nodeExecutorMap: ReadonlyMap<string, INodeExecutor>;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];

  private constructor(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    executionKind: ExecutionKind,
    graph: GraphRuntime,
    resolver: ParameterResolver,
    executorMap: Map<string, INodeExecutor>,
  ) {
    this.nodes = Object.freeze([...nodes]);
    this.edges = Object.freeze([...edges]);
    this.executionKind = executionKind;
    this.graph = graph;
    this.resolver = resolver;
    this.entryNodeIds = graph.entryNodeIds;
    this.nodeExecutorMap = executorMap;
  }

  static compile(nodes: WorkflowNode[], edges: WorkflowEdge[], executionKind: ExecutionKind): WorkflowPlan {
    const graph = new GraphRuntime(nodes, edges);
    const resolver = new ParameterResolver(nodes);

    const executorMap = new Map<string, INodeExecutor>();
    for (const node of nodes) {
      const exec = getNodeExecutor(resolveCategory(node));
      if (exec) executorMap.set(node.id, exec);
    }

    return new WorkflowPlan(nodes, edges, executionKind, graph, resolver, executorMap);
  }

  get isBacktest(): boolean {
    return this.executionKind === "backtest";
  }

  createRun(opts: {
    runId: string;
    workflowId: string;
    userId: string;
    mode?: "best-effort" | "fail-fast";
    abortSignal?: AbortSignal;
    flushPolicy?: FlushPolicy;
    isLive?: boolean;
  }): WorkflowRun {
    return new WorkflowRun(this, opts);
  }
}
