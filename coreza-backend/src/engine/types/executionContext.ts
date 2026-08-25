import { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { ExecutionMode } from "./executionError";

export interface MultiBarExecutionContext {
  timestamp: string;
  interval: string;
  symbols: string[];
  currentSymbol: string;
  bars: Record<string, any>;
  getBar: (symbol: string) => any | undefined;
}

export interface NodeExecutionContext {
  user_id?: string;
  userId: string;
  executionId: string;
  runId?: string;
  emissionId?: string;
  workflowId: string;
  nodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  resolvedParams: Record<string, any>;
  resolveNodeParameters: (
    node: WorkflowNode,
    input: any,
  ) => Record<string, any>;
  getAllNodeResults: () => Record<string, any>;
  dataContext?: any;
  indicatorStateManager?: any;
  abortSignal?: AbortSignal;
  checkCancellation: () => boolean;
  executionMode: ExecutionMode;
  isWarmingUp: boolean;
  multiBarContext?: MultiBarExecutionContext;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
}
