/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { INodeExecutor, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { DataContext, DataContextManager } from "./DataContext";
import {
  BacktestExecutionRuntime,
  BaseExecutionRuntime,
  StandardExecutionRuntime,
} from "./executionRuntime";
import { GraphRuntime } from "./graphRuntime";
import { IndicatorStateManager } from "./indicatorStateManager";
import { NodeStoreV2 } from "./nodeStoreV2";
import { ParameterResolver } from "./parameterResolver";

export class WorkflowEngine {
  private store: NodeStoreV2;
  private graph: GraphRuntime;
  private resolver: ParameterResolver;
  private runtime!: BaseExecutionRuntime;
  private dataContext: DataContext;
  private indicatorStateManager: IndicatorStateManager;
  readonly isBacktest: boolean;

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
    private mode: "best-effort" | "fail-fast" = "best-effort",
    private abortSignal?: AbortSignal,
  ) {
    this.store = new NodeStoreV2(runId, nodes);
    this.graph = new GraphRuntime(nodes, edges);
    this.resolver = new ParameterResolver(nodes);
    this.dataContext = DataContextManager.getInstance().getContext({
      runId,
      workflowId,
      userId,
    });

    this.isBacktest = nodes.some((node) =>
      (node.name || node.node_type || "").toLowerCase().includes("backtest"),
    );
    this.indicatorStateManager = new IndicatorStateManager(
      this.isBacktest ? 86400 : undefined,
    );

    this.rebuildRuntime();
  }

  private buildRuntimeOptions() {
    return {
      runId: this.runId,
      workflowId: this.workflowId,
      userId: this.userId,
      mode: this.mode,
      abortSignal: this.abortSignal,
      isBacktest: this.isBacktest,
      nodes: this.nodes,
      edges: this.edges,
      dataContext: this.dataContext,
      indicatorStateManager: this.indicatorStateManager,
    };
  }

  private rebuildRuntime(): void {
    this.runtime = this.isBacktest
      ? new BacktestExecutionRuntime(
          this.graph,
          this.store,
          this.resolver,
          this.buildRuntimeOptions(),
        )
      : new StandardExecutionRuntime(
          this.graph,
          this.store,
          this.resolver,
          this.buildRuntimeOptions(),
        );
  }

  getDataContext(): DataContext {
    return this.dataContext;
  }

  setIndicatorStateManager(manager: IndicatorStateManager): void {
    this.indicatorStateManager = manager;
    this.rebuildRuntime();
  }

  getIndicatorStateManager(): IndicatorStateManager {
    return this.indicatorStateManager;
  }

  getGraph(): GraphRuntime {
    return this.graph;
  }

  getNodeExecutorMap(): Map<string, INodeExecutor> {
    return this.runtime.getNodeExecutorMap();
  }

  getNodeState(nodeId: string, key: string): any {
    return this.store.getNodeState(nodeId, key);
  }

  setNodeState(nodeId: string, key: string, value: any): void {
    this.store.setNodeState(nodeId, key, value);
  }

  getCompiledParams() {
    return this.resolver.getCompiledParams();
  }

  clearNodeTiming(): void {
    this.runtime.clearNodeTiming();
  }

  reset(newRunId: string, abortSignal?: AbortSignal): void {
    DataContextManager.getInstance().destroyContext(this.runId);
    this.runId = newRunId;
    this.abortSignal = abortSignal;

    this.store = new NodeStoreV2(newRunId, this.nodes);
    this.dataContext = DataContextManager.getInstance().getContext({
      runId: newRunId,
      workflowId: this.workflowId,
      userId: this.userId,
    });

    this.rebuildRuntime();
  }

  resetForNextBar(full = false): void {
    this.runtime.resetForNextBar(full);
  }

  pinResults(results: Record<string, any>): void {
    this.store.pinResults(results);
  }

  preloadResults(results: Record<string, any>): void {
    for (const [nodeId, result] of Object.entries(results)) {
      this.store.setNodeResult(nodeId, result);
    }
  }

  async executeFromEntries(
    input: any,
    entryNodeIds: string[],
  ): Promise<{
    success: boolean;
    result?: any;
    executionOrder?: string[];
    error?: string;
  }> {
    try {
      for (const entryNodeId of entryNodeIds) {
        this.runtime.primeEntry(entryNodeId, input);
        this.runtime.enqueue({ nodeId: entryNodeId, input });
      }

      while (this.runtime.hasPending()) {
        if (this.abortSignal?.aborted) {
          throw new Error("Workflow cancelled by user");
        }

        const item = this.runtime.dequeue();
        if (!item) break;

        const maybePromise = this.runtime.executeOnce(item);
        if (maybePromise) await maybePromise;
      }

      if (this.runtime.hasFailures()) {
        return {
          success: false,
          error: this.runtime.getFailureMessage(),
          result: this.store.getAllResults(),
          executionOrder: this.runtime.getExecutionOrder(),
        };
      }

      return {
        success: true,
        result: this.store.getAllResults(),
        executionOrder: this.runtime.getExecutionOrder(),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        executionOrder: this.runtime.getExecutionOrder(),
      };
    }
  }

  async execute(
    initialInput?: any,
    startNodeId?: string,
  ): Promise<{
    success: boolean;
    result?: any;
    executionOrder?: string[];
    error?: string;
  }> {
    try {
      if (startNodeId && this.graph.nodeById.has(startNodeId)) {
        this.runtime.enqueue({ nodeId: startNodeId, input: initialInput });
      } else {
        const entryNodes = this.nodes.filter(
          (n) =>
            (n.node_type === "trigger" || n.node_type === "backtest") &&
            this.graph.getIncomingEdges(n.id).length === 0,
        );
        for (const node of entryNodes) {
          this.runtime.enqueue({ nodeId: node.id, input: initialInput });
        }
      }

      while (this.runtime.hasPending()) {
        if (this.abortSignal?.aborted) {
          throw new Error("Workflow cancelled by user");
        }

        const item = this.runtime.dequeue();
        if (!item) break;

        const maybePromise = this.runtime.executeOnce(item);
        if (maybePromise) await maybePromise;
      }

      await this.indicatorStateManager.flushToRedis();

      if (this.runtime.hasFailures()) {
        return {
          success: false,
          error: this.runtime.getFailureMessage(),
          result: this.store.getAllResults(),
          executionOrder: this.runtime.getExecutionOrder(),
        };
      }

      return {
        success: true,
        result: this.store.getAllResults(),
        executionOrder: this.runtime.getExecutionOrder(),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        executionOrder: this.runtime.getExecutionOrder(),
      };
    }
  }

  checkCancellation(): boolean {
    return this.abortSignal?.aborted ?? false;
  }

  destroy(): void {
    DataContextManager.getInstance().destroyContext(this.runId);
    this.indicatorStateManager.clearL1Cache();
  }

  getNodeTiming(): Record<string, { avgMs: number; totalMs: number; count: number }> {
    return this.runtime.getNodeTiming();
  }
}

export type ExecutionOptions = {
  mode?: "best-effort" | "fail-fast";
  initialInput?: any;
  startNodeId?: string;
  abortSignal?: AbortSignal;
};

export async function executeWorkflow(
  runId: string,
  workflowId: string,
  userId: string,
  nodes: any[],
  edges: any[],
  opts?: ExecutionOptions,
): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(
    runId,
    workflowId,
    userId,
    nodes,
    edges,
    opts?.mode,
    opts?.abortSignal,
  );

  try {
    return await workflowEngine.execute(opts?.initialInput, opts?.startNodeId);
  } finally {
    workflowEngine.destroy();
  }
}
