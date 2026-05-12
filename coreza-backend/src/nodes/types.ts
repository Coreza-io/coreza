/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface NodeInput {
  [key: string]: any;
}

export interface NodeResult {
  success?: boolean;
  data?: any;
  message?: string;
  channels?: any;
  subscriptionType?: string;
  status?: string;
  index?: number;
  isLastBatch?: boolean;
  callback_url?: string;
  error?: string;
  /**
   * Execution context metadata (e.g., error summaries, timing info).
   * For loop iteration context, use IterMeta in QueueItem.
   */
  meta?: Record<string, any>;
  /**
   * Engine routing signals (loopCompleted, loopIteration, sourceHandle, etc.)
   * that tell the workflow engine what action to take.
   */
  control?: ControlFlags;
}

export interface INodeExecutor {
  readonly category: string; // e.g. "IO", "Indicators", "Broker"
  execute(
    node: any,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult>;
  /** Indicates execute() is sync-capable for compiled VM usage. */
  readonly syncCapable?: boolean;
}

// Type for workflow node structure
export interface WorkflowNode {
  id: string;
  name?: string; // Actual node type (e.g., "GoogleWebSearch", "AIAgent", "Loop")
  /** Optional legacy type alias kept for backwards compatibility */
  type?: string;

  description?: string;
  /** Optional grouping metadata used by a few screeners */
  subCategory?: string;
  node_type: string; // Classification ("main" or "sub")
  category: string;
  values?: { [key: string]: any };
  data?: {
    definition?: any;
    values?: { [key: string]: any };
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// -----------------------------------------------------------------------------
// Experimental v2 engine types
// -----------------------------------------------------------------------------

/**
 * Represents an individual item that flows through the workflow engine.
 * Nodes in the new engine contract always receive and emit arrays of items.
 */
export interface Item {
  [key: string]: any;
}

/**
 * Optional flags that a node can return to influence engine behaviour.
 */
export interface ControlFlags {
  /** Re‑queue the current node for another pass (used by Loop). */
  requeueSelf?: boolean;
  /** Epoch milliseconds until the node should be executed again. */
  throttleUntil?: number;
  /** Persist arbitrary node local state. */
  setState?: Record<string, any>;
  /** Convenience branch decision for conditional nodes. */
  branch?: "true" | "false";

  // Unified loop control flags
  /** Loop completed all items - route to "done" handle */
  loopCompleted?: boolean;
  /** Loop iteration in progress - route to "loop" handle */
  loopIteration?: boolean;
  /** Items distributed to BullMQ for parallel execution */
  parallelDistributed?: boolean;
  /** Explicit source handle for routing */
  sourceHandle?: string;
  /** Current iteration index for sequential loops */
  currentIndex?: number;
  /** Whether this is the last batch in sequential mode */
  isLastBatch?: boolean;
  /** Whether this iteration is at the last item index */

  // Parallel distribution metadata
  /** Number of items being processed */
  itemCount?: number;
  /** ID of the loop node */
  loopId?: string;
  /** Max concurrent workers for parallel execution */
  maxConcurrency?: number;
  /** Continue processing on individual item errors */
  continueOnError?: boolean;
}

/**
 * Result returned by node executors in the new engine contract.
 */
export interface NodeExecutionOutput {
  /** Array of output items produced by the node. */
  output: Item[];
  /** Items that satisfied a condition (used by If nodes). */
  trueItems?: Item[];
  /** Items that did not satisfy a condition (used by If nodes). */
  falseItems?: Item[];
  /** Optional control instructions for the engine. */
  control?: ControlFlags;
  error?: string;
  meta?: Record<string, any>;
}

/**
 * Experimental executor interface used by the upcoming engine.v2. It mirrors
 * the classic executor but works purely with Item[] contracts.
 */
export interface INodeExecutorV2 {
  readonly category: string;
  execute(
    node: WorkflowNode,
    params: Record<string, any>,
    input: Item[],
    context?: any,
  ): Promise<NodeExecutionOutput>;
}

// -----------------------------------------------------------------------------
// New queue-based workflow execution types
// -----------------------------------------------------------------------------

/**
 * Iteration metadata that flows with every queued node execution
 */
export type IterMeta = {
  originLoopId?: string; // which Loop spawned this subtree
  iterIndex?: number; // iteration index of that Loop
  itemIndex?: number;
  parallel?: boolean;
};

/**
 * Queue item representing a single node execution task
 */
export type QueueItem = {
  nodeId: string;
  input?: any; // resolved "input" for this node
  meta?: IterMeta; // iteration scope marker
};
