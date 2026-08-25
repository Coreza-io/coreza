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

    if (process.env.ENABLE_CONSOLIDATOR_SCAN === "true") {
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const parentsByTarget = new Map<string, WorkflowNode[]>();
      for (const edge of edges) {
        const source = nodesById.get(edge.source);
        if (!source) continue;
        const parents = parentsByTarget.get(edge.target) ?? [];
        parents.push(source);
        parentsByTarget.set(edge.target, parents);
      }
      for (const [targetId, parents] of parentsByTarget) {
        const hasConsolidator = parents.some((node) => node.name === "Consolidator");
        const hasRegularParent = parents.some((node) => node.name !== "Consolidator");
        if (hasConsolidator && hasRegularParent) {
          console.warn(
            `[WorkflowPlan] Mixed consolidator join at node ${targetId} is not triggered by clock scans; ` +
            "use an all-consolidator join or a separate bounded payload cache",
          );
        }
      }
    }

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
    executionId: string;
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
