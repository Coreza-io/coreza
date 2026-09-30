export type NodeExecutionStatus =
  | "success"
  | "failed"
  | "cancelled"
  | "pinned"
  | "skipped"
  | "dependency-blocked"
  | "listener-started";

export interface NodeExecutionError {
  message: string;
  code?: string;
}

export interface NodeExecutionOutcome {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: unknown;
  error?: NodeExecutionError;
  reason?: string;
  selectedContinuation?: string;
}

export interface NodeExecutionRequest {
  input?: unknown;
  signal?: AbortSignal;
  allowedNodeIds?: ReadonlySet<string>;
  executionGeneration?: number;
  lockToken?: symbol;
}

export type EditorNodeAction = (
  request?: NodeExecutionRequest,
) => Promise<NodeExecutionOutcome>;

export interface EditorNodeActionSnapshot {
  readonly actions: ReadonlyMap<string, EditorNodeAction>;
  execute(nodeId: string, request?: NodeExecutionRequest): Promise<NodeExecutionOutcome>;
}

const actions = new Map<string, Map<string, EditorNodeAction>>();
const executionLocks = new Map<string, symbol>();
const consolidatorSeries = new Map<string, string>();
const runtimeKey = (sessionId: string, nodeId: string) => `${sessionId}\u0000${nodeId}`;

export const getEditorConsolidatorSeries = (sessionId: string, nodeId: string): string | undefined =>
  consolidatorSeries.get(runtimeKey(sessionId, nodeId));

export const setEditorConsolidatorSeries = (sessionId: string, nodeId: string, signature?: string): void => {
  const key = runtimeKey(sessionId, nodeId);
  if (signature === undefined) consolidatorSeries.delete(key);
  else consolidatorSeries.set(key, signature);
};

export function registerEditorNodeAction(
  sessionId: string,
  nodeId: string,
  action: EditorNodeAction,
): () => void {
  const sessionActions = actions.get(sessionId) ?? new Map<string, EditorNodeAction>();
  sessionActions.set(nodeId, action);
  actions.set(sessionId, sessionActions);
  // Keep the latest draft-backed action for the lifetime of the editor session.
  // Projection/virtualization may unmount a node, but execution must remain a
  // property of the canonical editor document rather than the rendered tree.
  return () => undefined;
}

/** Editor-owned imperative API used by buttons and coordinated execution alike. */
export async function executeEditorNode(
  sessionId: string,
  nodeId: string,
  request?: NodeExecutionRequest,
): Promise<NodeExecutionOutcome> {
  if (request?.signal?.aborted) return { nodeId, status: "cancelled", reason: "Execution was cancelled." };
  if (request?.allowedNodeIds && !request.allowedNodeIds.has(nodeId)) {
    return { nodeId, status: "failed", error: { message: `Node ${nodeId} is outside the allowed execution scope.` } };
  }
  const existingLock = executionLocks.get(sessionId);
  if (existingLock && request?.lockToken !== existingLock) {
    return { nodeId, status: "failed", reason: "Another editor execution is active.", error: { message: "Another editor execution is active." } };
  }
  const action = actions.get(sessionId)?.get(nodeId);
  if (!action) {
    return {
      nodeId,
      status: "failed",
      error: { message: `Node ${nodeId} is not available in the current editor session.` },
    };
  }
  if (existingLock) return action(request);
  const ownedToken = acquireEditorExecutionLock(sessionId);
  if (!ownedToken) {
    return { nodeId, status: "failed", reason: "Another editor execution is active.", error: { message: "Another editor execution is active." } };
  }
  try {
    return await action({ ...request, lockToken: request?.lockToken ?? ownedToken });
  } finally {
    releaseEditorExecutionLock(sessionId, ownedToken);
  }
}

export function acquireEditorExecutionLock(sessionId: string): symbol | null {
  if (executionLocks.has(sessionId)) return null;
  const token = Symbol(sessionId);
  executionLocks.set(sessionId, token);
  return token;
}

export function releaseEditorExecutionLock(sessionId: string, token: symbol): void {
  if (executionLocks.get(sessionId) === token) executionLocks.delete(sessionId);
}

export function isEditorExecutionLocked(sessionId: string): boolean {
  return executionLocks.has(sessionId);
}

/** Captures the current draft-backed actions so settings cannot change midway through a coordinated run. */
export function captureEditorNodeActions(
  sessionId: string,
  nodeIds: readonly string[],
): EditorNodeActionSnapshot {
  const registered = actions.get(sessionId);
  const captured = new Map<string, EditorNodeAction>();
  for (const nodeId of nodeIds) {
    const action = registered?.get(nodeId);
    if (!action) throw new Error(`Node ${nodeId} is not available in the current editor session.`);
    captured.set(nodeId, action);
  }
  const snapshot: EditorNodeActionSnapshot = {
    actions: captured,
    execute: async (nodeId: string, request?: NodeExecutionRequest): Promise<NodeExecutionOutcome> => {
      if (request?.signal?.aborted) return { nodeId, status: "cancelled", reason: "Execution was cancelled." };
      if (request?.allowedNodeIds && !request.allowedNodeIds.has(nodeId)) {
        return { nodeId, status: "failed", error: { message: `Node ${nodeId} is outside the allowed execution scope.` } };
      }
      const activeLock = executionLocks.get(sessionId);
      if (!activeLock || request?.lockToken !== activeLock) {
        return { nodeId, status: "failed", error: { message: "The captured execution lock is no longer active." } };
      }
      const action = captured.get(nodeId);
      if (!action) return { nodeId, status: "failed", error: { message: `Node ${nodeId} is outside the captured execution plan.` } };
      return action(request);
    },
  };
  return Object.freeze(snapshot);
}

export function clearEditorNodeActions(sessionId: string): void {
  actions.delete(sessionId);
  executionLocks.delete(sessionId);
  const prefix = `${sessionId}\u0000`;
  for (const key of consolidatorSeries.keys()) {
    if (key.startsWith(prefix)) consolidatorSeries.delete(key);
  }
}
