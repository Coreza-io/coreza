/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export interface NodeInput {
  [key: string]: any;
}

export interface NodeResult {
  success?: boolean;
  data?: any;
  error?: string;
  meta?: Record<string, any>;
}

export interface INodeExecutor {
  readonly category: string; // e.g. "IO", "Indicators", "Broker"
  execute(node: any, input: NodeInput, context?: any): Promise<NodeResult>;
}

// Type for workflow node structure
export interface WorkflowNode {
  id: string;
  name?: string; // Actual node type (e.g., "GoogleWebSearch", "AIAgent", "Loop")
  /** Optional legacy type alias kept for backwards compatibility */
  type?: string;
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
    context?: any
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
