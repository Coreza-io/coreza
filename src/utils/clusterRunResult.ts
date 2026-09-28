import type { PersistedNodeResult } from "./persistedNodeResult";
import {
  createNotExecutedOutput,
  createSkippedOutput,
  normalizePersistedNodeResult,
} from "./persistedNodeResult";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const outcomes = new Set(["executed", "skipped", "cancelled", "not-executed"]);

export interface ClusterRunResultResolution {
  finalized: boolean;
  outputs: ReadonlyMap<string, PersistedNodeResult>;
  warning?: string;
}

export function resolveClusterRunResult(
  result: unknown,
  memberNodeIds: readonly string[],
  runId: string,
): ClusterRunResultResolution {
  const outputs = new Map<string, PersistedNodeResult>();
  if (!isRecord(result)) {
    return { finalized: true, outputs, warning: "The run completed, but its node output is unavailable." };
  }
  if (result.resultFinalized === false) return { finalized: false, outputs };
  if (result.resultFinalized !== true || !isRecord(result.nodeResults) || !isRecord(result.nodeOutcomes)) {
    return { finalized: true, outputs, warning: "The run completed, but its node output is unavailable." };
  }

  let unavailable = false;
  for (const nodeId of memberNodeIds) {
    const hasResult = Object.prototype.hasOwnProperty.call(result.nodeResults, nodeId);
    const outcome = result.nodeOutcomes[nodeId];
    if (typeof outcome !== "string" || !outcomes.has(outcome) || (outcome === "executed" && !hasResult)) {
      unavailable = true;
      continue;
    }
    outputs.set(
      nodeId,
      hasResult
        ? normalizePersistedNodeResult(result.nodeResults[nodeId])
        : outcome === "skipped"
          ? createSkippedOutput(runId)
          : createNotExecutedOutput(runId, outcome === "cancelled"),
    );
  }
  return {
    finalized: true,
    outputs,
    warning: unavailable ? "Some node output is unavailable. Retry output to check again." : undefined,
  };
}
