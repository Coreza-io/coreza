import { NodeResult, WorkflowEdge, WorkflowNode } from "../../nodes/types";

export type ExecutionMode = "manual" | "live" | "backtest";
export type ExecutionPhase = "init" | "queue" | "execute" | "flush" | "destroy";

export interface ExecutionError {
  code: string;
  message: string;
  nodeId?: string;
  phase?: ExecutionPhase;
  retryable?: boolean;
  cause?: unknown;
}

export interface WorkflowExecutionResult {
  success: boolean;
  /** True once this envelope contains the worker's final available snapshots. */
  resultFinalized: boolean;
  nodeResults: Record<string, NodeResult>;
  executionOrder: string[];
  nodeOutcomes: Record<string, NodeExecutionOutcome>;
  error?: ExecutionError;
  timing?: Record<string, { avgMs: number; totalMs: number; count: number }>;
  boundaryOutputs?: Record<string, {
    sourceNodeId: string;
    sourceHandle?: string;
    targetNodeId: string;
    value: NodeResult | undefined;
  }>;
}

export type NodeExecutionOutcome =
  | "executed"
  | "skipped"
  | "cancelled"
  | "not-executed";

export function createNodeOutcomes(
  nodeIds: readonly string[],
  nodeResults: Readonly<Record<string, unknown>>,
  missingOutcome: Exclude<NodeExecutionOutcome, "executed">,
): Record<string, NodeExecutionOutcome> {
  return Object.fromEntries(nodeIds.map((nodeId) => [
    nodeId,
    Object.prototype.hasOwnProperty.call(nodeResults, nodeId) ? "executed" : missingOutcome,
  ]));
}

export type FlushPolicy = "always" | "on-success" | "never";

export interface RunOptions {
  runId: string;
  workflowId: string;
  userId: string;
  mode?: "best-effort" | "fail-fast";
  abortSignal?: AbortSignal;
  flushPolicy?: FlushPolicy;
  indicatorStateManager?: any;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function toExecutionError(
  error: unknown,
  phase: ExecutionPhase,
  nodeId?: string,
): ExecutionError {
  if (error instanceof Error) {
    const isCancelled = error.message.toLowerCase().includes("cancelled");
    return {
      code: isCancelled ? "CANCELLED" : "EXECUTION_ERROR",
      message: error.message,
      nodeId,
      phase,
      retryable: !isCancelled,
      cause: error,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
    nodeId,
    phase,
    retryable: false,
    cause: error,
  };
}
