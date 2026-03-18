import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { ExecutionKind } from "./types";
import { WorkflowPlan } from "./workflowPlan";
import { WorkflowRun } from "./workflowRun";

type CachedPlan = {
  plan: WorkflowPlan;
  lastUsed: number;
};

export class EnginePool {
  private static instance: EnginePool;
  private readonly cache = new Map<string, CachedPlan>();
  private readonly TTL_MS = 5 * 60 * 1000;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;

  private constructor() {
    setInterval(() => this.cleanupIdlePlans(), this.CLEANUP_INTERVAL_MS).unref();
  }

  static getInstance(): EnginePool {
    if (!EnginePool.instance) {
      EnginePool.instance = new EnginePool();
    }
    return EnginePool.instance;
  }

  getOrCreate(
    workflowId: string,
    runId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    opts?: {
      mode?: "best-effort" | "fail-fast";
      abortSignal?: AbortSignal;
      executionKind?: ExecutionKind;
    },
  ): WorkflowRun {
    let cached = this.cache.get(workflowId);

    if (!cached) {
      const plan = WorkflowPlan.compile(nodes, edges, opts?.executionKind ?? "standard");
      cached = { plan, lastUsed: Date.now() };
      this.cache.set(workflowId, cached);
    }

    cached.lastUsed = Date.now();

    return cached.plan.createRun({
      runId,
      workflowId,
      userId,
      mode: opts?.mode,
      abortSignal: opts?.abortSignal,
    });
  }

  evict(workflowId: string): void {
    this.cache.delete(workflowId);
  }

  private cleanupIdlePlans(): void {
    const now = Date.now();

    for (const [workflowId, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > this.TTL_MS) {
        this.cache.delete(workflowId);
      }
    }
  }
}
