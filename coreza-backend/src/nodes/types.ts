export interface NodeInput { 
  [key: string]: any; 
}

export interface NodeResult { 
  success?: boolean; 
  data?: any; 
  error?: string; 
}

export interface INodeExecutor {
  readonly category: string; // e.g. "IO", "Indicators", "Broker"
  execute(node: any, input: NodeInput, context?: any): Promise<NodeResult>;
}

// Type for workflow node structure
export interface WorkflowNode {
  id: string;
  type: string;
  category: string;
  values?: { [key: string]: any };
  data?: {
    definition?: any;
    values?: { [key: string]: any };
  };
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
  branch?: 'true' | 'false';
}

/**
 * Result returned by node executors in the new engine contract.
 */
export interface NodeExecutionOutput {
  /** Array of output items produced by the node. */
  output: Item[];
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
