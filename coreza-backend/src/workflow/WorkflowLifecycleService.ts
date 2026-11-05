import { PortfolioManager } from "../simulation/PortfolioManager";
import { randomUUID } from "crypto";
import { LiveStrategiesRepository } from "../repositories/LiveStrategiesRepository";
import { FillSyncWorker } from "../workers/FillSyncWorker";
import { isBrokerPortfolioWorkflow } from "../reporting/liveWorkflowFilter";
import { serializeNodeResults } from "../contracts/nodeResult";
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
      "id,name,user_id,nodes,edges,node_clusters,revision,is_active,schedule_cron,active_execution_id",
    )) as any;

    const trigger = detectSingleTriggerOrThrow(workflow.nodes ?? []);

    const existingReportingStatus = workflow.active_execution_id ? await LiveStrategiesRepository.status(workflow.active_execution_id) : null;
    const reporting = (trigger.kind !== "backtest" && isBrokerPortfolioWorkflow(workflow)) || ((workflow.is_active || !input.isActive) && existingReportingStatus !== null);
    let claimedId: string | undefined;
    if (input.isActive && reporting) {
      if (workflow.is_active) {
        if (await LiveStrategiesRepository.status(workflow.active_execution_id) !== "running") throw createError("Activation is starting or requires recovery; retry after it settles", 409);
        if (input.executionId && input.executionId !== workflow.active_execution_id) throw createError("Workflow is already active", 409);
        return { workflow, next_run_at: null, message: "Workflow already active" };
      }
      claimedId = input.executionId ?? randomUUID();
      // Keep claim failures outside cleanup: a competing request owns resources.
      await LiveStrategiesRepository.claim(input.userId, workflow.id, claimedId);
    } else if (!input.isActive && reporting && workflow.active_execution_id &&
      await LiveStrategiesRepository.status(workflow.active_execution_id) === "pending") {
      throw createError("Activation is still starting; retry stop after startup settles", 409);
    }

    try {
      if (input.isActive) {
        return await this.activate(
          workflow,
          trigger,
          input.userId,
          claimedId ?? input.executionId,
        );
      }

      return await this.deactivate(workflow, trigger, input.userId);
    } catch (error) {
      // Backtests release only the activation claimed by their own run.
      if (trigger.kind === "backtest" || (error as { statusCode?: number })?.statusCode === 409) throw error;
      if (claimedId) {
        await LiveStrategiesRepository.setStatus(claimedId, input.userId, workflow.id, "failed",
          error instanceof Error ? error.message : "Activation failed");
        // Preserve cleanup/drain ownership; report a failed start even with no output.
        try {
          const owner = await this.workflowRepo.getOwnedWorkflow(input.userId, workflow.id, "active_execution_id");
          if ((owner as any).active_execution_id !== claimedId) throw createError("Activation ownership changed", 409);
          if (trigger.kind === "streaming") await this.streaming.deactivateStreaming(input.userId, workflow.id);
          if (trigger.kind === "scheduler") await this.scheduler.unschedule(workflow.id);
          await this.streaming.cleanupWorkflowSubscriptions(input.userId, workflow.id);
          await this.workflowRepo.releaseBacktestActivation(input.userId, workflow.id, claimedId);
        } catch (cleanupError) { throw createError(`Activation failed; cleanup requires retry: ${String(cleanupError)}`, 502); }
      } else if (!reporting) {
        await this.workflowRepo.setActivationState(input.userId, input.workflowId, false, null).catch(() => undefined);
      }

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
          executionId ?? randomUUID(),
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
          const nodeResults = serializeNodeResults({ [trigger.node.id]: initOutput, ...control?.ownedNodeResults });
          result = {
            success: output.status === "success",
            resultFinalized: true,
            nodeResults,
            executionOrder: [trigger.node.id, ...(control?.ownedExecutionOrder ?? [])],
            nodeOutcomes: createNodeOutcomes(workflow.nodes.map((node: { id: string }) => node.id),
              nodeResults, output.status === "success" ? "skipped" : "not-executed"),
            ...(output.status !== "success" ? { error: {
              code: "BACKTEST_FAILED", message: output.error ?? "Backtest execution failed", phase: "execute" as const,
            } } : {}),
          };
          if (output.status !== "success") throw new Error(result.error!.message);
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

    const updated = executionId && isBrokerPortfolioWorkflow(workflow)
      ? await LiveStrategiesRepository.completeStart(userId, workflow.id, executionId, cronToSave)
      : await this.workflowRepo.setActivationState(userId, workflow.id, true, cronToSave, executionId ?? null);
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
    const reportingId = workflow.active_execution_id && await LiveStrategiesRepository.status(workflow.active_execution_id)
      ? workflow.active_execution_id : undefined;
    if (trigger.kind === "backtest" && !reportingId) {
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
    if (!workflow.is_active) return { workflow, next_run_at: null, message: "Workflow deactivated" };
    const stopToken = randomUUID();
    if (reportingId && !await LiveStrategiesRepository.claimStop(userId, workflow.id, reportingId, stopToken)) {
      return { workflow: await this.workflowRepo.getOwnedWorkflow(userId, workflow.id), next_run_at: null, message: "Workflow deactivated" };
    }
    try {
      if (reportingId) await LiveStrategiesRepository.setStatus(reportingId, userId, workflow.id, "cancelled");
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

      if (reportingId) {
        const activationId = reportingId;
        await FillSyncWorker.flushWorkflow(userId, workflow.id, activationId);
        PortfolioManager.retireInstance(userId, activationId);
        // Status is durable even if summary finalization needs a later worker retry.
        try { await LiveStrategiesRepository.refresh(activationId, true); }
        catch { LiveStrategiesRepository.markDirty(activationId); }
      }
      await this.streaming.cleanupWorkflowSubscriptions(userId, workflow.id);

      const updated = reportingId
        ? await this.workflowRepo.releaseBacktestActivation(userId, workflow.id, reportingId)
        : await this.workflowRepo.setActivationState(userId, workflow.id, false, null);

      return {
        workflow: updated,
        next_run_at: null,
        message: "Workflow deactivated",
      };
    } finally {
      if (reportingId) await LiveStrategiesRepository.releaseStop(userId, workflow.id, reportingId, stopToken);
    }
  }

  async deleteWorkflow(userId: string, workflowId: string): Promise<void> {
    const workflow = (await this.workflowRepo.getOwnedWorkflow(
      userId,
      workflowId,
      "id,user_id,nodes,edges,is_active,active_execution_id",
    )) as any;

    if (workflow.is_active) {
      const trigger = detectSingleTriggerOrThrow(workflow.nodes ?? []);
      if (workflow.active_execution_id && await LiveStrategiesRepository.status(workflow.active_execution_id) === "pending") {
        throw createError("Activation is still starting; retry deletion after startup settles", 409);
      }
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

