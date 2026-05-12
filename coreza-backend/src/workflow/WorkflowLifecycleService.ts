import { createError } from "../middleware/errorHandler";
import { BacktestLifecycleAdapter } from "../backtest";
import { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import { StreamingLifecycleAdapter } from "./StreamingLifecycleAdapter";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";
import { computeCron } from "./schedulePolicy";
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
      "id,user_id,nodes,edges,is_active,schedule_cron",
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
      await this.workflowRepo
        .setActivationState(input.userId, input.workflowId, false, null)
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
        );

        const runId = (run as any).id;

        try {
          await this.backtest.startBacktest(
            runId,
            workflow.id,
            userId,
            workflow.nodes,
            workflow.edges,
            trigger.node,
          );
          message = "Backtest workflow activated";
        } catch (error: unknown) {
          await this.runRepo.markRunFailed(
            runId,
            error instanceof Error
              ? error.message
              : "Backtest initialization failed",
          );
          throw error;
        }
        break;
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
      case "backtest":
        await this.runRepo.cancelActiveBacktests(workflow.id);
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
      "id,user_id,nodes,edges,is_active",
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
