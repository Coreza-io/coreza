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
