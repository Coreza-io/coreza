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
const variableInvocations = new Map<symbol, { owner: string; workflowId?: string; snapshot: Promise<import("../../coreza-backend/src/variables/contract").VariableSnapshot> }>();
export function getEditorVariableSnapshot(token: symbol | undefined, owner: string, load: () => Promise<import("../../coreza-backend/src/variables/contract").VariableSnapshot>, workflowId?: string) {
  if (!token) return load();
  const existing = variableInvocations.get(token);
  if (existing) { if (existing.owner !== owner || existing.workflowId !== workflowId) throw new Error("Variable invocation owner changed"); return existing.snapshot; }
  const snapshot = load(); variableInvocations.set(token, { owner, workflowId, snapshot }); return snapshot;
}

export function publishEditorVariableSnapshot(token: symbol | undefined, owner: string, snapshot: import("../../coreza-backend/src/variables/contract").VariableSnapshot): void {
  if (!token) return;
  const existing = variableInvocations.get(token);
  if (!existing || existing.owner !== owner || snapshot.owner !== owner || existing.workflowId !== snapshot.workflowId) throw new Error("Variable invocation owner changed");
  variableInvocations.set(token, { owner, workflowId: snapshot.workflowId, snapshot: Promise.resolve(snapshot) });
}

export type EditorNodeAction = (
  request?: NodeExecutionRequest,
) => Promise<NodeExecutionOutcome>;

export interface EditorNodeActionSnapshot {
  readonly actions: ReadonlyMap<string, EditorNodeAction>;
  execute(nodeId: string, request?: NodeExecutionRequest): Promise<NodeExecutionOutcome>;
}

const actions = new Map<string, Map<string, EditorNodeAction>>();
const canonicalNodeIds = new Map<string, ReadonlySet<string>>();
const executionLocks = new Map<string, symbol>();
const executionTargets = new Map<string, { kind: "node" | "cluster" | "workflow"; id: string }>();
const executionListeners = new Map<string, Set<() => void>>();
const consolidatorSeries = new Map<string, string>();
const runtimeKey = (sessionId: string, nodeId: string) => `${sessionId}\u0000${nodeId}`;

export const getEditorConsolidatorSeries = (sessionId: string, nodeId: string): string | undefined =>
  consolidatorSeries.get(runtimeKey(sessionId, nodeId));

export const setEditorConsolidatorSeries = (sessionId: string, nodeId: string, signature?: string): void => {
  const key = runtimeKey(sessionId, nodeId);
  if (signature === undefined) consolidatorSeries.delete(key);
  else consolidatorSeries.set(key, signature);
};

/** Keep actions for hidden canonical members, but never for removed identities. */
export function syncEditorNodeActionIds(sessionId: string, nodes: readonly { id: string }[]): void {
  const previous = canonicalNodeIds.get(sessionId);
  if (previous?.size === nodes.length && nodes.every(({ id }) => previous.has(id))) return;
  const ids = new Set(nodes.map(({ id }) => id));
  canonicalNodeIds.set(sessionId, ids);
  const sessionActions = actions.get(sessionId);
  for (const id of sessionActions?.keys() ?? []) {
    if (!ids.has(id)) sessionActions?.delete(id);
  }
}

export function registerEditorNodeAction(
  sessionId: string,
  nodeId: string,
  action: EditorNodeAction,
): () => void {
  // A projected host can publish an old effect after its identity was retired.
  const ids = canonicalNodeIds.get(sessionId);
  if (ids && !ids.has(nodeId)) return () => undefined;
  const sessionActions = actions.get(sessionId) ?? new Map<string, EditorNodeAction>();
  sessionActions.set(nodeId, action);
  actions.set(sessionId, sessionActions);
  // Keep the latest draft-backed action for the lifetime of the editor session.
  // Projection/virtualization may unmount a node, but execution must remain a
  // property of the canonical editor document rather than the rendered tree.
  return () => undefined;
}

export function canRenameEditorNodeAction(sessionId: string, oldId: string, newId: string): boolean {
  if (oldId === newId) return true;
  return !actions.get(sessionId)?.has(newId);
}

export function retireEditorNodeAction(sessionId: string, nodeId: string): void {
  actions.get(sessionId)?.delete(nodeId);
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
  const ownedToken = acquireEditorExecutionLock(sessionId, { kind: "node", id: nodeId });
  if (!ownedToken) {
    return { nodeId, status: "failed", reason: "Another editor execution is active.", error: { message: "Another editor execution is active." } };
  }
  try {
    return await action({ ...request, lockToken: request?.lockToken ?? ownedToken });
  } finally {
    releaseEditorExecutionLock(sessionId, ownedToken);
  }
}

export function acquireEditorExecutionLock(
  sessionId: string,
  target: { kind: "node" | "cluster" | "workflow"; id: string } = { kind: "workflow", id: sessionId },
): symbol | null {
  if (executionLocks.has(sessionId)) return null;
  const token = Symbol(sessionId);
  executionLocks.set(sessionId, token);
  executionTargets.set(sessionId, target);
  executionListeners.get(sessionId)?.forEach((listener) => listener());
  return token;
}

export function releaseEditorExecutionLock(sessionId: string, token: symbol): void {
  variableInvocations.delete(token);
  if (executionLocks.get(sessionId) === token) {
    executionLocks.delete(sessionId);
    executionTargets.delete(sessionId);
    executionListeners.get(sessionId)?.forEach((listener) => listener());
  }
}

export function subscribeEditorExecution(sessionId: string, listener: () => void): () => void {
  const listeners = executionListeners.get(sessionId) ?? new Set<() => void>();
  listeners.add(listener);
  executionListeners.set(sessionId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) executionListeners.delete(sessionId);
  };
}

export function getEditorExecutionTarget(sessionId: string): string {
  const target = executionTargets.get(sessionId);
  return target ? `${target.kind}:${target.id}` : "";
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
  const token = executionLocks.get(sessionId);
  if (token) variableInvocations.delete(token);
  actions.delete(sessionId);
  canonicalNodeIds.delete(sessionId);
  executionLocks.delete(sessionId);
  executionTargets.delete(sessionId);
  executionListeners.get(sessionId)?.forEach((listener) => listener());
  const prefix = `${sessionId}\u0000`;
  for (const key of consolidatorSeries.keys()) {
    if (key.startsWith(prefix)) consolidatorSeries.delete(key);
  }
}
