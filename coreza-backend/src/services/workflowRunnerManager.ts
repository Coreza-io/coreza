import { withActivationRedis } from "../variables/ActivationRegistry";
import { RedisKeys } from "../infra/redisKeys";
import { isPersistentVariableEdit, referencesVariables } from "../variables/contract";
import { LiveStrategiesRepository } from "../repositories/LiveStrategiesRepository";
import { FillSyncWorker } from "../workers/FillSyncWorker";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowRunner } from "./WorkflowRunner";

export class WorkflowRunnerManager {
  private static instance: WorkflowRunnerManager;
  private readonly runners = new Map<string, WorkflowRunner>();
  private readonly transitions = new Map<string, Promise<void>>();

  private async transition(workflowId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.transitions.get(workflowId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.transitions.set(workflowId, current);
    try { await current; }
    finally { if (this.transitions.get(workflowId) === current) this.transitions.delete(workflowId); }
  }

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
    return this.transition(workflowId, () => this.startRunner(workflowId, userId, nodes, edges, executionId));
  }

  private async startRunner(
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    executionId?: string,
  ): Promise<void> {
    const existing = this.runners.get(workflowId);
    if (existing) {
      if (existing.requiresRecovery) throw new Error("Strategy stop incomplete; finish stopping before restarting");
      // If the existing runner has the same session, no-op.
      // Otherwise stop the stale runner first so the new session takes over.
      if (executionId && existing.runnerInstanceId !== executionId) {
        console.log(
          `[WorkflowRunnerManager] Replacing runner for ${workflowId}: old session → new session ${executionId}`,
        );
        await existing.stop();
        this.runners.delete(workflowId);
      } else {
        return;
      }
    }

    const usesVariables = referencesVariables(nodes.map(node => node.values)) || nodes.some(isPersistentVariableEdit);
    if (usesVariables) {
      if (!executionId) throw new Error("Variable-dependent live strategies require a new activation ID");
      // A worker may not reconstruct lost RAM for an already admitted activation.
      const status = await LiveStrategiesRepository.status(executionId);
      if (status && status !== "pending") throw new Error("Variable-dependent activation interrupted; stop it and activate again");
      const admitted = await withActivationRedis(client => client.set(RedisKeys.liveEphemeralActivation(userId, workflowId, executionId!), "started", "NX"));
      if (admitted !== "OK") throw new Error("Variable-dependent activation interrupted; stop it and activate again");
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
      try {
        await runner.stop();
        if (this.runners.get(workflowId) === runner) this.runners.delete(workflowId);
      } catch { console.warn("[WorkflowRunnerManager] Startup stop incomplete; runner retained for recovery"); }
      throw error;
    }
    if (this.runners.get(workflowId) !== runner) throw new Error("Strategy startup cancelled");

    runner.start().catch((error) => {
      console.error(
        `[WorkflowRunnerManager] Strategy ${workflowId} crashed:`,
        error,
      );
      void LiveStrategiesRepository.setStatus(runner.runnerInstanceId, userId, workflowId, "failed", error instanceof Error ? error.message : "Strategy runner failed")
        .catch(reportingError => console.error("Failed to record activation failure", reportingError));
      void runner.stop().then(async () => {
        await FillSyncWorker.flushWorkflow(userId, workflowId, runner.runnerInstanceId);
        if (this.runners.get(workflowId) === runner) this.runners.delete(workflowId);
      }).catch(() => console.warn("[WorkflowRunnerManager] Runner stop incomplete; recovery metadata retained"));
    });
  }

  async stopStrategy(workflowId: string): Promise<void> {
    return this.transition(workflowId, () => this.stopRunner(workflowId));
  }

  private async stopRunner(workflowId: string): Promise<void> {
    const runner = this.runners.get(workflowId);
    if (!runner) return;

    await runner.stop();
    this.runners.delete(workflowId);
  }

  isRunning(workflowId: string): boolean {
    const runner = this.runners.get(workflowId);
    return !!runner && !runner.requiresRecovery;
  }

  async stopAll(): Promise<void> {
    const failures: unknown[] = [];
    const workflowIds = new Set([...this.runners.keys(), ...this.transitions.keys()]);
    for (const workflowId of workflowIds) {
      try { await this.stopStrategy(workflowId); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Strategy stops incomplete; recovery required");
  }
}
