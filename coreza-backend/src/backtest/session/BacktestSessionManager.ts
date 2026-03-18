import { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { BacktestSession, BarEvent } from "./BacktestSession";
import { IndicatorStateManager } from "../../engine/indicatorStateManager";

export class BacktestSessionManager {
  private static instance: BacktestSessionManager;
  private readonly sessions = new Map<string, BacktestSession>();
  private readonly scopeIndex = new Map<string, string>();

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
    bars: BarEvent[],
    runId: string,
    stateManager?: IndicatorStateManager,
  ): BacktestSession {
    const scopeKey = `${workflowId}:${nodeId}`;
    const existingBacktestId = this.scopeIndex.get(scopeKey);

    if (existingBacktestId) {
      const oldSession = this.sessions.get(existingBacktestId);
      if (oldSession) {
        oldSession.cleanup();
      }
      this.sessions.delete(existingBacktestId);
      this.scopeIndex.delete(scopeKey);
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
    );

    this.sessions.set(backtestId, session);
    this.scopeIndex.set(scopeKey, backtestId);

    return session;
  }

  getSession(backtestId: string): BacktestSession | undefined {
    return this.sessions.get(backtestId);
  }

  deleteSession(backtestId: string): void {
    const session = this.sessions.get(backtestId);
    if (!session) {
      return;
    }

    session.cleanup();
    this.sessions.delete(backtestId);
    const scopeKey = `${session.workflowId}:${session.nodeId}`;
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
