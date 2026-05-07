/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { ExecutionMode } from "../../engine/types";

export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  userId: string;
  nodes: any[];
  edges: any[];
  trigger?:
    | "manual"
    | "backtest"
    | "scheduled"
    | "webhook"
    | "redis_pubsub"
    | "market_data"
    | "loop_parallel"
    | "loop_continuation";
  initialInput?: any;
  executionMode?: ExecutionMode;
  /** If true, skip all database logging for this run (high-frequency optimization) */
  useRedisStorage?: boolean;

  /** Parent workflow run that spawned this parallel loop item */
  parentRunId?: string;
  /** Loop node id that created this job */
  loopId?: string;
  /** Index of the current loop item (for ordered aggregation) */
  itemIndex?: number;
  /** Total number of loop items */
  totalItems?: number;
  /** Marker for aggregator jobs that collate child results */
  isLoopAggregator?: boolean;
  /** Continue processing even if some items fail */
  continueOnError?: boolean;
}

/** Options for parallel loop execution */
export interface ParallelLoopOptions {
  /** Maximum concurrent workers for this loop (default: 10) */
  maxConcurrency?: number;
  /** Continue processing remaining items even if some fail */
  continueOnError?: boolean;
  /** Use Redis storage for high-frequency runs (default: true) */
  useRedisStorage?: boolean;
  /** Done edges to route to after parallel loop completion */
  doneEdges?: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  /** Full workflow nodes for continuation context */
  parentNodes?: any[];
  /** Full workflow edges for continuation context */
  parentEdges?: any[];
  /** Parent workflow store data (all node outputs) for child context */
  parentStoreData?: Record<string, any>;
  /** Execution mode to propagate into loop child/continuation jobs */
  executionMode?: ExecutionMode;
}

export interface IWorkflowJobQueue {
  addWorkflowExecution(data: WorkflowJobData): Promise<any>;
  addParallelLoopExecution(
    parentRunId: string,
    loopId: string,
    workflowId: string,
    userId: string,
    subgraphNodes: any[],
    subgraphEdges: any[],
    items: any[],
    options?: ParallelLoopOptions
  ): Promise<void>;
  startWorkflowRunner(
    workflowId: string,
    userId: string,
    nodes: any[],
    edges: any[],
    executionId?: string
  ): Promise<void>;
  startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: any[],
    edges: any[],
    backtestInitNode: any
  ): Promise<void>;
  stopWorkflowRunner(workflowId: string): Promise<void>;
  /** Cancel all queued/running jobs for a workflow and return count of cancelled jobs */
  cancelWorkflowJobs(userId: string, workflowId: string): Promise<number>;
  getQueueStats(): Promise<any>;
  cleanup(): Promise<void>;
}
