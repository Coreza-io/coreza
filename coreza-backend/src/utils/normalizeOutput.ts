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
import axios from "axios";
import {
  StandardNodeOutput,
  NodeExecutionStatus,
  NormalizeContext,
  isStandardNodeOutput,
} from "../types/nodeOutput";
import { NodeResult } from "../nodes/types";

/**
 * Normalize NodeResult or any raw response into StandardNodeOutput format
 * This is the primary function executors should use
 */
export function normalizeOutput(
  raw: NodeResult | any,
  context: NormalizeContext = {}
): StandardNodeOutput {
  const now = new Date().toISOString();
  const executionTime = context.startTime
    ? Date.now() - context.startTime
    : undefined;

  const baseMeta = {
    timestamp: now,
    executionTime,
    nodeId: context.nodeId,
    nodeName: context.nodeName,
    category: context.category,
  };

  // Already in standard format - just add/update meta
  if (isStandardNodeOutput(raw)) {
    return {
      ...raw,
      meta: { ...baseMeta, ...raw.meta },
    };
  }

  // Handle null/undefined
  if (raw === null || raw === undefined) {
    return {
      success: true,
      status: "success",
      data: null,
      meta: baseMeta,
    };
  }

  // Handle NodeResult format { success?: boolean, data?: any, error?: string, meta?: any, control?: any }
  if (
    typeof raw?.success === "boolean" ||
    raw?.error ||
    raw?.data !== undefined
  ) {
    const success = raw.success !== false && !raw.error;
    const status: NodeExecutionStatus = success ? "success" : "error";

    return {
      success,
      status,
      data: raw.data,
      error: raw.error,
      meta: { ...baseMeta, cached: raw.meta?.cached },
    };
  }

  // Handle streaming/waiting status objects
  if (raw?.status && typeof raw.status === "string") {
    const statusMap: Record<string, NodeExecutionStatus> = {
      waiting: "waiting",
      streaming: "streaming",
      listening: "listening",
      pending: "pending",
      running: "running",
      success: "success",
      error: "error",
    };
    const mappedStatus = statusMap[raw.status] || "success";
    const isError = mappedStatus === "error";

    return {
      success: !isError,
      status: mappedStatus,
      data: raw,
      error: isError ? raw.message || raw.error : undefined,
      meta: baseMeta,
    };
  }

  // Default: treat as successful data
  return {
    success: true,
    status: "success",
    data: raw,
    meta: baseMeta,
  };
}

/**
 * Convert StandardNodeOutput back to NodeResult for executor compatibility
 * Used when executors need to return the legacy format
 */
export function toNodeResult(output: StandardNodeOutput): NodeResult {
  return {
    success: output.success,
    data: output.data,
    error: output.error,
    meta: output.meta,
  };
}

/**
 * Create a success output with data
 */
export function createSuccessOutput<T = any>(
  data: T,
  context: NormalizeContext = {}
): StandardNodeOutput<T> {
  return {
    success: true,
    status: "success",
    data,
    meta: {
      timestamp: new Date().toISOString(),
      executionTime: context.startTime
        ? Date.now() - context.startTime
        : undefined,
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}

function normalizeError(err: unknown) {
  if (axios.isAxiosError(err)) {
    return {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      response: err.response?.data,
    };
  }

  if (err instanceof Error) {
    return {
      message: err.message,
    };
  }

  return {
    message: String(err),
  };
}

/**
 * Create an error output
 */
export function createErrorOutput(
  error: unknown,
  context: NormalizeContext = {}
): StandardNodeOutput {
  const normalized = normalizeError(error);

  return {
    success: false,
    status: "error",

    // ✅ user-safe
    error: normalized.response.message,

    // ✅ structured (optional, UI can show on expand)
    details: {
      code: normalized.code,
      status: normalized.status,
      response: normalized.response.message,
    },

    meta: {
      timestamp: new Date().toISOString(),
      executionTime: context.startTime
        ? Date.now() - context.startTime
        : undefined,
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}

/**
 * Create a waiting output for streaming/webhook nodes
 */
export function createWaitingOutput(
  message: string,
  data: any = {},
  context: NormalizeContext = {}
): StandardNodeOutput {
  return {
    success: true,
    status: "waiting",
    data: { message, ...data },
    meta: {
      timestamp: new Date().toISOString(),
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}

/**
 * Create a streaming output
 */
export function createStreamingOutput(
  data: any,
  context: NormalizeContext = {}
): StandardNodeOutput {
  return {
    success: true,
    status: "streaming",
    data,
    meta: {
      timestamp: new Date().toISOString(),
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}
