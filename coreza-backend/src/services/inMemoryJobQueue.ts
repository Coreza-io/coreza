import { supabase } from "../config/supabase";
import { WebSocketManager } from "./websocketManager";
import { executeWorkflow } from "./workflowEngine";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";

export class InMemoryJobQueue implements IWorkflowJobQueue {
  async addWorkflowExecution(data: WorkflowJobData): Promise<void> {
    const { runId, workflowId, userId, nodes, edges } = data;
    console.log(`🚀 [IN-MEMORY] Executing workflow ${workflowId} immediately`);

    try {
      await supabase
        .from("workflow_runs")
        .update({ status: "running" })
        .eq("id", runId);

      const result = await executeWorkflow(runId, workflowId, userId, nodes, edges);

      WebSocketManager.sendToUser(userId, {
        type: "workflow_completed",
        payload: {
          runId,
          success: result.success,
          result: result.result,
          error: result.error,
        },
      });
    } catch (error: any) {
      console.error(`❌ [IN-MEMORY] Workflow execution failed:`, error);
      WebSocketManager.sendToUser(userId, {
        type: "workflow_failed",
        payload: { runId, error: error?.message ?? "Unknown error" },
      });
    }
  }

  async getQueueStats() {
    return { mode: "in-memory", active: 0, waiting: 0, completed: 0, failed: 0 };
  }

  async cleanup(): Promise<void> {
    console.log("✅ [IN-MEMORY] No cleanup needed");
  }
}

export const inMemoryJobQueue = new InMemoryJobQueue();
