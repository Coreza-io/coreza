export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  userId: string;
  nodes: any[];
  edges: any[];
  trigger?: "manual" | "scheduled" | "webhook" | "redis_pubsub";
}

export interface IWorkflowJobQueue {
  addWorkflowExecution(data: WorkflowJobData): Promise<any>;
  getQueueStats(): Promise<any>;
  cleanup(): Promise<void>;
}
