import { INodeExecutor, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { DataContext } from "./DataContext";
import { IndicatorStateManager } from "./indicatorStateManager";
import { ExecutionKind, WorkflowExecutionResult } from "./types";
import { WorkflowPlan } from "./workflowPlan";
import { WorkflowRun } from "./workflowRun";

export class WorkflowEngine {
  private readonly plan: WorkflowPlan;
  private run: WorkflowRun;
  private readonly workflowId: string;
  private readonly userId: string;
  private readonly mode: "best-effort" | "fail-fast";
  readonly isBacktest: boolean;

  constructor(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    mode: "best-effort" | "fail-fast" = "best-effort",
    abortSignal?: AbortSignal,
    executionKind?: ExecutionKind,
  ) {
    this.workflowId = workflowId;
    this.userId = userId;
    this.mode = mode;

    const kind = executionKind ?? this.detectKind(nodes);
    this.plan = WorkflowPlan.compile(nodes, edges, kind);
    this.isBacktest = this.plan.isBacktest;
    this.run = this.plan.createRun({ runId, workflowId, userId, mode, abortSignal });
  }

  private detectKind(nodes: WorkflowNode[]): ExecutionKind {
    const detected = nodes.some((n) => (n.name || n.node_type || "").toLowerCase().includes("backtest"));
    if (detected) {
      console.warn("[WorkflowEngine] DEPRECATED: isBacktest detected via node name. Pass executionKind explicitly.");
    }
    return detected ? "backtest" : "standard";
  }

  getGraph() { return this.plan.graph as Readonly<typeof this.plan.graph>; }
  getNodeExecutorMap(): ReadonlyMap<string, INodeExecutor> { return this.plan.nodeExecutorMap; }
  getCompiledParams() { return this.run.getCompiledParams(); }
  getDataContext(): DataContext { return this.run.getDataContext(); }
  getIndicatorStateManager(): IndicatorStateManager { return this.run.getIndicatorStateManager(); }
  setIndicatorStateManager(m: IndicatorStateManager): void { this.run.setIndicatorStateManager(m); }
  getNodeState(nodeId: string, key: string): any { return this.run.getNodeState(nodeId, key); }
  setNodeState(nodeId: string, key: string, value: any): void { this.run.setNodeState(nodeId, key, value); }
  clearNodeTiming(): void { this.run.clearNodeTiming(); }
  getNodeTiming() { return this.run.getNodeTiming(); }
  pinResults(results: Record<string, any>): void { this.run.pinResults(results); }
  preloadResults(results: Record<string, any>): void { this.run.preloadResults(results); }
  resetForNextBar(full = false): void { this.run.resetForNextBar(full); }
  setExecutionId(executionId: string): void { this.run.setExecutionId(executionId); }
  checkCancellation(): boolean { return this.run.checkCancellation(); }

  reset(newRunId: string, abortSignal?: AbortSignal): void { this.resetForNewRun(newRunId, abortSignal); }

  resetForNewRun(newRunId: string, abortSignal?: AbortSignal): void {
    this.run.destroy();
    this.run = this.plan.createRun({
      runId: newRunId,
      workflowId: this.workflowId,
      userId: this.userId,
      mode: this.mode,
      abortSignal,
    });
  }

  async execute(initialInput?: unknown, startNodeId?: string): Promise<WorkflowExecutionResult> {
    return this.run.execute(initialInput, startNodeId);
  }

  async executeFromEntries(input: unknown, entryNodeIds: string[]): Promise<WorkflowExecutionResult> {
    return this.run.executeFromEntries(input, entryNodeIds);
  }

  destroy(): void { this.run.destroy(); }
}

export type ExecutionOptions = {
  mode?: "best-effort" | "fail-fast";
  executionKind?: ExecutionKind;
  initialInput?: unknown;
  startNodeId?: string;
  abortSignal?: AbortSignal;
};

export async function executeWorkflow(
  runId: string,
  workflowId: string,
  userId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  opts?: ExecutionOptions,
): Promise<WorkflowExecutionResult> {
  const plan = WorkflowPlan.compile(nodes, edges, opts?.executionKind ?? "standard");
  const run = plan.createRun({ runId, workflowId, userId, mode: opts?.mode, abortSignal: opts?.abortSignal });
  try {
    return await run.execute(opts?.initialInput, opts?.startNodeId);
  } finally {
    run.destroy();
  }
}
