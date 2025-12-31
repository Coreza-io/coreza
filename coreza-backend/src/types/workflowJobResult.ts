/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
