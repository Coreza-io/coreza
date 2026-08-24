import { INodeExecutor, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { DataContext } from "./DataContext";
import { IndicatorStateManager } from "./indicatorStateManager";
import { ExecutionMode, WorkflowExecutionResult } from "./types";
import { WorkflowPlan } from "./workflowPlan";
import { WorkflowRun } from "./workflowRun";
import type { ConsolidatorEmission } from "./consolidation/consolidatorScan";

export class WorkflowEngine {
  private readonly plan: WorkflowPlan;
  private run: WorkflowRun;
  private readonly workflowId: string;
  private readonly userId: string;
  private readonly mode: "best-effort" | "fail-fast";
  readonly executionMode: ExecutionMode;
  readonly isBacktest: boolean;

  constructor(
    executionId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    mode: "best-effort" | "fail-fast" = "best-effort",
    abortSignal?: AbortSignal,
    executionMode?: ExecutionMode,
  ) {
    this.workflowId = workflowId;
    this.userId = userId;
    this.mode = mode;

    const detectedExecutionMode = executionMode ?? this.detectMode(nodes);
    this.executionMode = detectedExecutionMode;
    this.plan = WorkflowPlan.compile(nodes, edges, detectedExecutionMode);
    this.isBacktest = this.plan.isBacktest;
    this.run = this.plan.createRun({
      executionId,
      workflowId,
      userId,
      mode,
      abortSignal,
      executionMode: this.executionMode,
    });
  }

  private detectMode(nodes: WorkflowNode[]): ExecutionMode {
    const detected = nodes.some((n) =>
      (n.name || n.node_type || "").toLowerCase().includes("backtest"),
    );
    if (detected) {
      console.warn(
        "[WorkflowEngine] DEPRECATED: isBacktest detected via node name. Pass executionMode explicitly.",
      );
    }
    return detected ? "backtest" : "manual";
  }

  getGraph() {
    return this.plan.graph as Readonly<typeof this.plan.graph>;
  }
  getNodeExecutorMap(): ReadonlyMap<string, INodeExecutor> {
    return this.plan.nodeExecutorMap;
  }
  getCompiledParams() {
    return this.run.getCompiledParams();
  }
  getDataContext(): DataContext {
    return this.run.getDataContext();
  }
  getIndicatorStateManager(): IndicatorStateManager {
    return this.run.getIndicatorStateManager();
  }
  setIndicatorStateManager(m: IndicatorStateManager): void {
    this.run.setIndicatorStateManager(m);
  }
  getNodeState(nodeId: string, key: string): any {
    return this.run.getNodeState(nodeId, key);
  }
  setNodeState(nodeId: string, key: string, value: any): void {
    this.run.setNodeState(nodeId, key, value);
  }
  clearNodeTiming(): void {
    this.run.clearNodeTiming();
  }
  getNodeTiming() {
    return this.run.getNodeTiming();
  }
  pinResults(results: Record<string, any>): void {
    this.run.pinResults(results);
  }
  preloadResults(results: Record<string, any>): void {
    this.run.preloadResults(results);
  }
  resetForNextBar(full = false): void {
    this.run.resetForNextBar(full);
  }
  setRunId(runId: string): void {
    this.run.setRunId(runId);
  }
  checkCancellation(): boolean {
    return this.run.checkCancellation();
  }

  reset(newExecutionId: string, abortSignal?: AbortSignal): void {
    this.resetForNewRun(newExecutionId, abortSignal);
  }

  resetForNewRun(newExecutionId: string, abortSignal?: AbortSignal): void {
    this.run.destroy();
    this.run = this.plan.createRun({
      executionId: newExecutionId,
      workflowId: this.workflowId,
      userId: this.userId,
      mode: this.mode,
      abortSignal,
      executionMode: this.executionMode,
    });
  }

  async execute(
    initialInput?: unknown,
    startNodeId?: string,
  ): Promise<WorkflowExecutionResult> {
    return this.run.execute(initialInput, startNodeId);
  }

  async executeFromEntries(
    input: unknown,
    entryNodeIds: string[],
  ): Promise<WorkflowExecutionResult> {
    return this.run.executeFromEntries(input, entryNodeIds);
}

  async executeInjectedResults(
    emissions: readonly ConsolidatorEmission[],
    onBatchSuccess?: (delivered: readonly ConsolidatorEmission[]) => void,
  ): Promise<WorkflowExecutionResult> {
    return this.run.executeInjectedResults(emissions, onBatchSuccess);
  }

  destroy(): void {
    this.run.destroy();
  }
}

export type ExecutionOptions = {
  mode?: "best-effort" | "fail-fast";
  executionMode?: ExecutionMode;
  initialInput?: unknown;
  startNodeId?: string;
  abortSignal?: AbortSignal;
};

export async function executeWorkflow(
  executionId: string,
  workflowId: string,
  userId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  opts?: ExecutionOptions,
): Promise<WorkflowExecutionResult> {
  const plan = WorkflowPlan.compile(
    nodes,
    edges,
    opts?.executionMode ?? "manual",
  );
  const run = plan.createRun({
    executionId,
    workflowId,
    userId,
    mode: opts?.mode,
    abortSignal: opts?.abortSignal,
    executionMode: opts?.executionMode ?? plan.executionMode,
  });
  try {
    return await run.execute(opts?.initialInput, opts?.startNodeId);
  } finally {
    run.destroy();
  }
}
