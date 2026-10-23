import { readPublicNodeResult, resultState, type NodeResult } from "./nodeResult";
export type PersistedNodeResult = NodeResult<unknown>;
export const normalizePersistedNodeResult = (value: unknown): PersistedNodeResult => readPublicNodeResult(value);
export const createRunPendingOutput = (runId: string): PersistedNodeResult => resultState("pending", null, { meta: { runId } });
export const createNotExecutedOutput = (runId: string, cancelled = false): PersistedNodeResult => ({
  ...resultState(cancelled ? "cancelled" : "not-executed", null, { meta: { runId } }),
  error: cancelled ? "Cancelled before this node executed" : "Not executed in this run",
});
export const createSkippedOutput = (runId: string): PersistedNodeResult => resultState("skipped", null, { meta: { runId } });
