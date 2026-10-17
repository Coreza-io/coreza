import { createError } from "../middleware/errorHandler";
import { BacktestLifecycleAdapter } from "../backtest";
import { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import { StreamingLifecycleAdapter } from "./StreamingLifecycleAdapter";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";
import { computeCron } from "./schedulePolicy";
import { createNodeOutcomes, type WorkflowExecutionResult } from "../engine/types";
import {
  detectSingleTriggerOrThrow,
  type ClassifiedTrigger,
} from "./triggerClassifier";

export interface ActivationResult {
  workflow: any;
  next_run_at: string | null;
  message: string;
}

export class WorkflowLifecycleService {
  constructor(
    private workflowRepo: WorkflowRepository,
    private runRepo: WorkflowRunRepository,
    private streaming: StreamingLifecycleAdapter,
    private scheduler: SchedulerLifecycleAdapter,
    private backtest: BacktestLifecycleAdapter,
  ) {}

  async setActivationState(input: {
    userId: string;
    workflowId: string;
    isActive: boolean;
    executionId?: string;
  }): Promise<ActivationResult> {
    const workflow = (await this.workflowRepo.getOwnedWorkflow(
      input.userId,
      input.workflowId,
      "id,user_id,nodes,edges,node_clusters,revision,is_active,schedule_cron,active_execution_id",
    )) as any;

    const trigger = detectSingleTriggerOrThrow(workflow.nodes ?? []);

    try {
      if (input.isActive) {
        return await this.activate(
          workflow,
          trigger,
          input.userId,
          input.executionId,
        );
      }

      return await this.deactivate(workflow, trigger, input.userId);
    } catch (error) {
      // Backtests release only the activation claimed by their own run.
      if (trigger.kind === "backtest") throw error;
      await this.workflowRepo.setActivationState(input.userId, input.workflowId, false, null)
        .catch(() => undefined);

      const message =
        error instanceof Error ? error.message : "Unknown activation error";
      throw createError(`Activation failed: ${message}`, 502);
    }
  }

  private async activate(
    workflow: any,
    trigger: ClassifiedTrigger,
    userId: string,
    executionId?: string,
  ): Promise<ActivationResult> {
    let cronToSave: string | null = null;
    let nextRun: string | null = null;
    let message = "";

    switch (trigger.kind) {
      case "scheduler": {
        const schedule = computeCron(trigger.node);
        cronToSave = schedule.cron;
        nextRun = schedule.next;
        await this.scheduler.schedule(
          workflow.id,
          userId,
          schedule.cron,
          schedule.timezone,
        );
        message = "Workflow scheduled";
        break;
      }
      case "streaming": {
        const sourceId = await this.streaming.activateStreaming(
          userId,
          workflow.id,
          trigger.node,
          workflow.nodes,
          workflow.edges,
          executionId,
        );
        message = `Workflow subscribed to streaming source ${sourceId}`;
        break;
      }
      case "webhook": {
        message = "Webhook listener activated";
        break;
      }
      case "backtest": {
        const run = await this.runRepo.createRun(
          workflow.id,
          userId,
          workflow.nodes,
          workflow.edges,
          workflow.node_clusters,
          workflow.revision,
        );

        const runId = (run as any).id;
        let claimed = false;
        let completed = false;
        let updated: any;
        let result: WorkflowExecutionResult | undefined;

        try {
          await this.workflowRepo.claimBacktestActivation(userId, workflow.id, runId);
          claimed = true;
          const output = await this.backtest.startBacktest(
            runId,
            workflow.id,
            userId,
            workflow.nodes,
            workflow.edges,
            trigger.node,
          );
          const { control, ...initOutput } = output;
          const nodeResults = { [trigger.node.id]: initOutput, ...control?.ownedNodeResults };
          result = {
            success: output.success === true,
            resultFinalized: true,
            nodeResults,
            executionOrder: [trigger.node.id, ...(control?.ownedExecutionOrder ?? [])],
            nodeOutcomes: createNodeOutcomes(workflow.nodes.map((node: { id: string }) => node.id),
              nodeResults, output.success ? "skipped" : "not-executed"),
            ...(!output.success ? { error: {
              code: "BACKTEST_FAILED", message: output.error ?? "Backtest execution failed", phase: "execute" as const,
            } } : {}),
          };
          if (!output.success) throw new Error(result.error!.message);
          completed = await this.runRepo.finishBacktestRun(userId, workflow.id, runId, "success", null, result);
        } catch (error: unknown) {
          await this.runRepo.finishBacktestRun(userId, workflow.id, runId, "failed",
            error instanceof Error ? error.message : "Backtest initialization failed",
            result ? { ...result, success: false, error: {
              code: "BACKTEST_FAILED", message: error instanceof Error ? error.message : "Backtest failed", phase: "execute",
            } } : undefined);
          throw error;
        } finally {
          if (claimed) updated = await this.workflowRepo.releaseBacktestActivation(userId, workflow.id, runId);
        }
        return {
          workflow: updated,
          next_run_at: null, message: completed ? "Backtest completed" : "Backtest cancelled",
        };
      }
    }

    const updated = await this.workflowRepo.setActivationState(
      userId,
      workflow.id,
      true,
      cronToSave,
      executionId ?? null,
    );

    return {
      workflow: updated,
      next_run_at: nextRun,
      message,
    };
  }

  private async deactivate(
    workflow: any,
    trigger: ClassifiedTrigger,
    userId: string,
  ): Promise<ActivationResult> {
    if (trigger.kind === "backtest") {
      const runId = typeof workflow.active_execution_id === "string" ? workflow.active_execution_id : null;
      if (!workflow.is_active) {
        return { workflow, next_run_at: null, message: "Workflow deactivated" };
      }
      if (runId) {
        await this.runRepo.requestCancellation(runId);
        this.backtest.cancelRun(runId);
        await this.runRepo.markRunCancelled(runId);
      }
      const updated = await this.workflowRepo.releaseBacktestActivation(userId, workflow.id, runId);
      return { workflow: updated, next_run_at: null, message: "Workflow deactivated" };
    }
    const cancelledJobs = await this.scheduler.cancelJobs(userId, workflow.id);

    if (cancelledJobs > 0) {
      await this.runRepo.cancelActiveRuns(workflow.id);
    }

    switch (trigger.kind) {
      case "scheduler":
        await this.scheduler.unschedule(workflow.id);
        break;
      case "streaming":
        await this.streaming.deactivateStreaming(userId, workflow.id);
        break;
      case "webhook":
        break;
    }

    await this.streaming.cleanupWorkflowSubscriptions(userId, workflow.id);

    const updated = await this.workflowRepo.setActivationState(
      userId,
      workflow.id,
      false,
      null,
    );

    return {
      workflow: updated,
      next_run_at: null,
      message: "Workflow deactivated",
    };
  }

  async deleteWorkflow(userId: string, workflowId: string): Promise<void> {
    const workflow = (await this.workflowRepo.getOwnedWorkflow(
      userId,
      workflowId,
      "id,user_id,nodes,edges,is_active,active_execution_id",
    )) as any;

    if (workflow.is_active) {
      const trigger = detectSingleTriggerOrThrow(workflow.nodes ?? []);
      await this.deactivate(workflow, trigger, userId);
    }

    await this.streaming.fullCleanup(
      userId,
      workflowId,
      workflow.nodes ?? [],
      Boolean(workflow.is_active),
      { skipSubscriptionCleanup: Boolean(workflow.is_active) },
    );
    await this.scheduler.unschedule(workflowId);
    await this.workflowRepo.delete(userId, workflowId);
  }
}
