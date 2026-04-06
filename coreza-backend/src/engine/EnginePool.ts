import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { ExecutionMode } from "./types";
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
    executionId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    opts?: {
      mode?: "best-effort" | "fail-fast";
      abortSignal?: AbortSignal;
      executionMode?: ExecutionMode;
    },
  ): WorkflowRun {
    const mode = opts?.executionMode ?? "manual";
    const cacheKey = `${workflowId}:${mode}`;
    let cached = this.cache.get(cacheKey);

    if (!cached) {
      const plan = WorkflowPlan.compile(nodes, edges, mode);
      cached = { plan, lastUsed: Date.now() };
      this.cache.set(cacheKey, cached);
    }

    cached.lastUsed = Date.now();

    return cached.plan.createRun({
      executionId,
      workflowId,
      userId,
      mode: opts?.mode,
      abortSignal: opts?.abortSignal,
      executionMode: cached.plan.executionMode,
    });
  }

  evict(workflowId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${workflowId}:`)) {
        this.cache.delete(key);
      }
    }
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
