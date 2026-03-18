import { WorkflowEdge, WorkflowNode } from "../../nodes/types";

export interface NodeExecutionContext {
  user_id: string;
  userId: string;
  runId: string;
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
  isBacktest?: boolean;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
}
