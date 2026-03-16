import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { ExecutionOptions, WorkflowEngine } from "./workflowEngine";

type CachedEngine = {
  engine: WorkflowEngine;
  lastUsed: number;
};

export class EnginePool {
  private static instance: EnginePool;
  private readonly cache = new Map<string, CachedEngine>();
  private readonly TTL_MS = 5 * 60 * 1000;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;

  private constructor() {
    setInterval(() => this.cleanupIdleEngines(), this.CLEANUP_INTERVAL_MS).unref();
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
    opts?: Pick<ExecutionOptions, "mode" | "abortSignal">,
  ): WorkflowEngine {
    const cached = this.cache.get(workflowId);

    if (cached) {
      cached.engine.reset(runId, opts?.abortSignal);
      cached.lastUsed = Date.now();
      return cached.engine;
    }

    const engine = new WorkflowEngine(
      runId,
      workflowId,
      userId,
      nodes,
      edges,
      opts?.mode,
      opts?.abortSignal,
    );

    this.cache.set(workflowId, { engine, lastUsed: Date.now() });
    return engine;
  }

  evict(workflowId: string): void {
    const cached = this.cache.get(workflowId);
    if (cached) {
      cached.engine.destroy();
      this.cache.delete(workflowId);
    }
  }

  private cleanupIdleEngines(): void {
    const now = Date.now();

    for (const [workflowId, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > this.TTL_MS) {
        this.cache.delete(workflowId);
      }
    }
  }
}
