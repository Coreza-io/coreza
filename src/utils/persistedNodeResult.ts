import type { StandardNodeOutput } from "@/types/nodeOutput";
import { isStandardNodeOutput } from "@/types/nodeOutput";

export type PersistedNodeResult = StandardNodeOutput<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string | undefined => {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return undefined;
};

/** Interprets one workflow_runs.result.nodeResults value without affecting siblings. */
export function normalizePersistedNodeResult(value: unknown): PersistedNodeResult {
  if (isStandardNodeOutput(value)) return value;

  if (!isRecord(value)) {
    return { success: true, status: "success", data: value };
  }

  const status = typeof value.status === "string" ? value.status.toLowerCase() : undefined;
  const error = errorMessage(value.error);
  const failed = value.success === false || status === "failed" || status === "error" || Boolean(error);
  const skipped = status === "skipped";
  const hasEnvelope =
    Object.prototype.hasOwnProperty.call(value, "success") ||
    Object.prototype.hasOwnProperty.call(value, "data") ||
    Object.prototype.hasOwnProperty.call(value, "error") ||
    Object.prototype.hasOwnProperty.call(value, "meta") ||
    status !== undefined;

  if (!hasEnvelope) return { success: true, status: "success", data: value };

  return {
    success: skipped || !failed,
    status: skipped ? "skipped" : failed ? "error" : "success",
    ...(Object.prototype.hasOwnProperty.call(value, "data") ? { data: value.data } : {}),
    ...(error ? { error } : {}),
    ...(isRecord(value.details) ? { details: value.details } : {}),
    ...(isRecord(value.meta) ? {
      meta: {
        timestamp: typeof value.meta.timestamp === "string" ? value.meta.timestamp : new Date().toISOString(),
        ...value.meta,
      },
    } : {}),
  };
}

export function createRunPendingOutput(runId: string): PersistedNodeResult {
  return { success: true, status: "pending", meta: { timestamp: new Date().toISOString(), runId } };
}

export function createNotExecutedOutput(runId: string, cancelled = false): PersistedNodeResult {
  return {
    success: false,
    status: cancelled ? "cancelled" : "not-executed",
    error: cancelled ? "Cancelled before this node executed" : "Not executed in this run",
    meta: { timestamp: new Date().toISOString(), runId },
  };
}
