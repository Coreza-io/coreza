import { decodeLegacyNodeResult, serializeNodeResult, serializeNodeResults } from "../contracts/nodeResult";
import type { WorkflowExecutionResult } from "../engine/types";

export type RedisRunResultUpdate =
  | WorkflowExecutionResult
  | { result?: WorkflowExecutionResult; errorMessage?: string };

export function normalizeRedisRunResultUpdate(update: RedisRunResultUpdate): {
  result?: WorkflowExecutionResult;
  errorMessage?: string;
} {
  if ("result" in update || "errorMessage" in update) {
    return { result: update.result, errorMessage: update.errorMessage };
  }
  return { result: update };
}

/** Project only known result slots at a persistence boundary, including edge-keyed cluster outputs. */
export function serializeWorkflowRunResult(result: WorkflowExecutionResult): WorkflowExecutionResult {
  let publicError = result.error;
  if (publicError) {
    const { cause, ...diagnostic } = publicError;
    publicError = diagnostic;
  }
  return {
    ...result,
    nodeResults: serializeNodeResults(result.nodeResults),
    ...(publicError ? { error: publicError } : {}),
    ...(result.boundaryOutputs ? { boundaryOutputs: Object.fromEntries(Object.entries(result.boundaryOutputs).map(([edgeId, boundary]) => [edgeId, {
      ...boundary,
      value: boundary.value === undefined ? undefined : serializeNodeResult(decodeLegacyNodeResult(boundary.value, "history")),
    }])) } : {}),
  };
}
