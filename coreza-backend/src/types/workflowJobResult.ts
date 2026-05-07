/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { StandardNodeOutput } from "./nodeOutput";

/**
 * Reasons why a workflow job was cancelled
 */
export type WorkflowCancellationReason =
  | "workflow_deactivated"
  | "user_request"
  | "timeout";

/**
 * Result when a workflow job is cancelled before execution
 */
export interface WorkflowCancelledResult {
  cancelled: true;
  reason: WorkflowCancellationReason;
}

/**
 * Result when a workflow job completes successfully
 */
export interface WorkflowSuccessResult extends StandardNodeOutput {
  cancelled?: false;
}

/**
 * Loop item result with index for ordering
 */
export interface LoopItemResult extends StandardNodeOutput {
  itemIndex: number;
  cancelled?: false;
}

/**
 * Union type for all possible workflow job results
 */
export type WorkflowJobResult =
  | WorkflowSuccessResult
  | WorkflowCancelledResult
  | LoopItemResult;

/**
 * Type guard to check if result is a cancellation
 */
export function isWorkflowCancelled(
  result: WorkflowJobResult
): result is WorkflowCancelledResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "cancelled" in result &&
    result.cancelled === true
  );
}

/**
 * Type guard to check if result is a loop item
 */
export function isLoopItemResult(
  result: WorkflowJobResult
): result is LoopItemResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "itemIndex" in result
  );
}
