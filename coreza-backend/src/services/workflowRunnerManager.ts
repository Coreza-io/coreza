import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowRunner } from "./WorkflowRunner";

export class WorkflowRunnerManager {
  private static instance: WorkflowRunnerManager;
  private readonly runners = new Map<string, WorkflowRunner>();

  static getInstance(): WorkflowRunnerManager {
    if (!WorkflowRunnerManager.instance) {
      WorkflowRunnerManager.instance = new WorkflowRunnerManager();
    }
    return WorkflowRunnerManager.instance;
  }

  async startStrategy(
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    executionId?: string,
  ): Promise<void> {
    const existing = this.runners.get(workflowId);
    if (existing) {
      // If the existing runner has the same session, no-op.
      // Otherwise stop the stale runner first so the new session takes over.
      if (executionId && (existing as any).runnerInstanceId !== executionId) {
        console.log(
          `[WorkflowRunnerManager] Replacing runner for ${workflowId}: old session → new session ${executionId}`,
        );
        await existing.stop();
        this.runners.delete(workflowId);
      } else {
        return;
      }
    }

    const runner = new WorkflowRunner(
      workflowId,
      userId,
      nodes,
      edges,
      executionId,
    );
    this.runners.set(workflowId, runner);
    try { await runner.initialize(); }
    catch (error) {
      if (this.runners.get(workflowId) === runner) this.runners.delete(workflowId);
      await runner.stop().catch(() => console.warn("[WorkflowRunnerManager] Startup cleanup failed"));
      throw error;
    }
    if (this.runners.get(workflowId) !== runner) throw new Error("Strategy startup cancelled");

    runner.start().catch((error) => {
      console.error(
        `[WorkflowRunnerManager] Strategy ${workflowId} crashed:`,
        error,
      );
      if (this.runners.get(workflowId) === runner) this.runners.delete(workflowId);
      void runner.stop().catch(() => console.warn("[WorkflowRunnerManager] Runner cleanup failed"));
    });
  }

  async stopStrategy(workflowId: string): Promise<void> {
    const runner = this.runners.get(workflowId);
    if (!runner) return;

    await runner.stop();
    this.runners.delete(workflowId);
  }

  isRunning(workflowId: string): boolean {
    return this.runners.has(workflowId);
  }

  async stopAll(): Promise<void> {
    for (const [workflowId, runner] of this.runners.entries()) {
      await runner.stop();
      this.runners.delete(workflowId);
    }
  }
}
