import { NodeResult, WorkflowEdge, WorkflowNode } from "../../nodes/types";

export type ExecutionKind = "standard" | "backtest";
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
  result?: Record<string, unknown>;
  executionOrder?: string[];
  error?: ExecutionError;
  timing?: Record<string, { avgMs: number; totalMs: number; count: number }>;
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
