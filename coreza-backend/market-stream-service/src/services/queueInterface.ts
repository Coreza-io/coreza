/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  userId: string;
  nodes: any[];
  edges: any[];
  trigger?:
    | "manual"
    | "scheduled"
    | "webhook"
    | "redis_pubsub"
    | "market_data"
    | "loop_parallel";
  initialInput?: any;
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
  getQueueStats(): Promise<any>;
  cleanup(): Promise<void>;
}
