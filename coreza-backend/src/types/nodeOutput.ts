/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * Standard node execution status types
 */
export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "waiting"
  | "streaming"
  | "listening";

/**
 * Metadata attached to every node output
 */
export interface NodeOutputMeta {
  timestamp?: string;
  executionTime?: number;
  nodeId?: string;
  nodeName?: string;
  category?: string;
  cached?: boolean;
}

export interface StandardErrorDetails {
  code?: string;
  status?: number;
  response?: unknown;
}

/**
 * Unified node output format for both frontend and backend
 * All node executions should return this format
 */
export interface StandardNodeOutput<T = any> {
  /** Whether the execution succeeded */
  success: boolean;
  /** Current execution status */
  status: NodeExecutionStatus;
  /** Actual output data from the node */
  data?: T;
  /** Error message if execution failed */
  error?: string;
  /** Error deatils */
  details?: StandardErrorDetails;
  /** Execution metadata */
  meta?: NodeOutputMeta;
}

/**
 * Context provided when normalizing output
 */
export interface NormalizeContext {
  nodeId?: string;
  nodeName?: string;
  category?: string;
  startTime?: number;
  skipTimestamp?: boolean;
}

/**
 * Check if an object conforms to StandardNodeOutput format
 */
export function isStandardNodeOutput(obj: any): obj is StandardNodeOutput {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.success === "boolean" &&
    typeof obj.status === "string" &&
    [
      "pending",
      "running",
      "success",
      "error",
      "waiting",
      "streaming",
      "listening",
    ].includes(obj.status)
  );
}

/**
 * Extract just the data from a StandardNodeOutput, or return raw value if not standard format
 */
export function extractOutputData<T = any>(
  output: StandardNodeOutput<T> | any
): T {
  if (isStandardNodeOutput(output)) {
    return output.data;
  }
  return output;
}
