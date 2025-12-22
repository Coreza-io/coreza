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

import {
  StandardNodeOutput,
  NodeExecutionStatus,
  NormalizeContext,
  isStandardNodeOutput,
} from '@/types/nodeOutput';

/**
 * Normalize any raw response into StandardNodeOutput format
 * Handles various legacy formats and API responses
 */
export function normalizeOutput(
  raw: any,
  context: NormalizeContext = {}
): StandardNodeOutput {
  const now = new Date().toISOString();
  const executionTime = context.startTime ? Date.now() - context.startTime : undefined;

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
      status: 'success',
      data: null,
      meta: baseMeta,
    };
  }

  // Handle explicit error objects
  if (raw?.error && typeof raw.error === 'string') {
    return {
      success: false,
      status: 'error',
      error: raw.error,
      data: raw.data,
      meta: { ...baseMeta, ...raw.meta },
    };
  }

  // Handle legacy success format { success: boolean, data?: any, error?: string }
  if (typeof raw?.success === 'boolean') {
    const status: NodeExecutionStatus = raw.success ? 'success' : 'error';
    return {
      success: raw.success,
      status,
      data: raw.data,
      error: raw.error,
      meta: { ...baseMeta, cached: raw.meta?.cached },
    };
  }

  // Handle streaming/waiting status objects
  if (raw?.status && typeof raw.status === 'string') {
    const statusMap: Record<string, NodeExecutionStatus> = {
      waiting: 'waiting',
      streaming: 'streaming',
      listening: 'listening',
      pending: 'pending',
      running: 'running',
      success: 'success',
      error: 'error',
    };
    const mappedStatus = statusMap[raw.status] || 'success';
    const isError = mappedStatus === 'error';

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
    status: 'success',
    data: raw,
    meta: baseMeta,
  };
}

/**
 * Create a pending output for when execution starts
 */
export function createPendingOutput(context: NormalizeContext = {}): StandardNodeOutput {
  return {
    success: true,
    status: 'pending',
    meta: {
      timestamp: new Date().toISOString(),
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}

/**
 * Create a running output for when execution is in progress
 */
export function createRunningOutput(context: NormalizeContext = {}): StandardNodeOutput {
  return {
    success: true,
    status: 'running',
    meta: {
      timestamp: new Date().toISOString(),
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}

/**
 * Create an error output
 */
export function createErrorOutput(
  error: string | Error,
  context: NormalizeContext = {}
): StandardNodeOutput {
  return {
    success: false,
    status: 'error',
    error: error instanceof Error ? error.message : error,
    meta: {
      timestamp: new Date().toISOString(),
      executionTime: context.startTime ? Date.now() - context.startTime : undefined,
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
    status: 'waiting',
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
 * Create a success output with data
 */
export function createSuccessOutput<T = any>(
  data: T,
  context: NormalizeContext = {}
): StandardNodeOutput<T> {
  return {
    success: true,
    status: 'success',
    data,
    meta: {
      timestamp: new Date().toISOString(),
      executionTime: context.startTime ? Date.now() - context.startTime : undefined,
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      category: context.category,
    },
  };
}
