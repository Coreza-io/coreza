import { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { BacktestSession, MultiBarEvent } from "./BacktestSession";
import type { IndicatorInitialization } from "./BacktestSession";
import { IndicatorStateManager } from "../../engine/indicatorStateManager";

export class BacktestSessionManager {
  private static instance: BacktestSessionManager;
  private readonly sessions = new Map<string, BacktestSession>();
  private readonly scopeIndex = new Map<string, string>();
  private readonly editorExpiry = new Map<string, ReturnType<typeof setTimeout>>();

  private renewEditorSession(backtestId: string): void {
    clearTimeout(this.editorExpiry.get(backtestId));
    const timer = setTimeout(() => {
      const session = this.sessions.get(backtestId);
      if (session?.isExecuting) this.renewEditorSession(backtestId);
      else this.deleteSession(backtestId);
    }, 30 * 60 * 1000);
    timer.unref();
    this.editorExpiry.set(backtestId, timer);
  }

  static getInstance(): BacktestSessionManager {
    if (!BacktestSessionManager.instance) {
      BacktestSessionManager.instance = new BacktestSessionManager();
    }
    return BacktestSessionManager.instance;
  }

  createSession(
    backtestId: string,
    workflowId: string,
    nodeId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    entryNodeIds: string[],
    backtestInitResult: Record<string, any>,
    bars: MultiBarEvent[],
    runId: string,
    stateManager?: IndicatorStateManager,
    indicatorInitialization?: IndicatorInitialization,
    persistResults = true,
    parentRunId?: string,
  ): BacktestSession {
    const scopeKey = `${userId}:${workflowId}:${nodeId}:${persistResults ? "database" : runId}`;
    const existingBacktestId = this.scopeIndex.get(scopeKey);

    if (existingBacktestId) {
      this.deleteSession(existingBacktestId);
    }

    const session = new BacktestSession(
      backtestId,
      workflowId,
      nodeId,
      userId,
      nodes,
      edges,
      entryNodeIds,
      backtestInitResult,
      bars,
      runId,
      stateManager,
      indicatorInitialization,
      persistResults,
      parentRunId,
    );

    this.sessions.set(backtestId, session);
    this.scopeIndex.set(scopeKey, backtestId);
    if (!persistResults) this.renewEditorSession(backtestId);

    return session;
  }

  getSession(backtestId: string): BacktestSession | undefined {
    const session = this.sessions.get(backtestId);
    if (session && !session.persistResults) this.renewEditorSession(backtestId);
    return session;
  }

  getEditorSession(userId: string, workflowId: unknown, executionId: unknown): BacktestSession | undefined {
    if (typeof workflowId !== "string" || typeof executionId !== "string") return;
    for (const session of this.sessions.values()) {
      if (!session.persistResults && session.userId === userId && session.workflowId === workflowId
        && session.executionId === executionId) {
        this.renewEditorSession(session.backtestId);
        return session;
      }
    }
  }

  deleteSession(backtestId: string): void {
    const session = this.sessions.get(backtestId);
    if (!session) {
      return;
    }

    clearTimeout(this.editorExpiry.get(backtestId));
    this.editorExpiry.delete(backtestId);
    session.cleanup();
    this.sessions.delete(backtestId);
    const scopeKey = `${session.userId}:${session.workflowId}:${session.nodeId}:${session.persistResults ? "database" : session.executionId}`;
    if (this.scopeIndex.get(scopeKey) === backtestId) {
      this.scopeIndex.delete(scopeKey);
    }
  }

  async stopBacktest(backtestId: string): Promise<void> {
    this.deleteSession(backtestId);
  }

  isRunning(backtestId: string): boolean {
    const session = this.sessions.get(backtestId);
    return !!session && session.status === "running";
  }

  async stopAll(): Promise<void> {
    for (const backtestId of this.sessions.keys()) {
      this.deleteSession(backtestId);
    }
  }
}
