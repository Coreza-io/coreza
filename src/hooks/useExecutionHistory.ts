/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;
const MAX_CACHED_EXECUTIONS = PAGE_SIZE * 2;

export type ExecutionStatus =
  | "all"
  | "success"
  | "failed"
  | "running"
  | "pending"
  | "cancelled";

export interface ExecutionFilters {
  status?: ExecutionStatus;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}

export interface NodeExecutionLog {
  nodeId: string;
  nodeName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  input: unknown;
  output: unknown;
  itemCount: number;
  error?: string;
}

type ExecutionNodeResult =
  | {
      success?: boolean;
      status?: string;
      data?: unknown;
      error?: string;
      [key: string]: unknown;
    }
  | unknown;

export interface ExecutionResultPayload {
  success?: boolean;
  nodeResults?: Record<string, ExecutionNodeResult>;
  executionOrder?: string[];
  error?: string | { code?: string; phase?: string; message?: string };
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ExecutionRun {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  result: ExecutionResultPayload | null;
  initiated_by: string | null;
  // Workflow snapshot at execution time
  nodes: unknown[] | null;
  edges: unknown[] | null;
  node_count: number | null;
  edge_count: number | null;
}

type NormalizedNodeResult = {
  success: boolean;
  status: "success" | "failed" | "skipped";
  data?: unknown;
  error?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toExclusiveDateTo(date: Date): Date {
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return end;
}

function matchesExecutionFilters(
  execution: ExecutionRun,
  filters: ExecutionFilters,
): boolean {
  if (
    filters.status &&
    filters.status !== "all" &&
    execution.status !== filters.status
  ) {
    return false;
  }

  const startedAtMs = new Date(execution.started_at).getTime();

  if (filters.dateFrom) {
    const fromMs = filters.dateFrom.getTime();
    if (startedAtMs < fromMs) {
      return false;
    }
  }

  if (filters.dateTo) {
    const exclusiveEndMs = toExclusiveDateTo(filters.dateTo).getTime();
    if (startedAtMs >= exclusiveEndMs) {
      return false;
    }
  }

  return true;
}

function applyFiltersToQuery(workflowId: string, filters: ExecutionFilters) {
  let query = supabase
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", workflowId);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.dateFrom) {
    query = query.gte("started_at", filters.dateFrom.toISOString());
  }

  if (filters.dateTo) {
    query = query.lt(
      "started_at",
      toExclusiveDateTo(filters.dateTo).toISOString(),
    );
  }

  return query;
}

function dedupeById(executions: ExecutionRun[]): ExecutionRun[] {
  const seen = new Set<string>();
  const result: ExecutionRun[] = [];

  for (const execution of executions) {
    if (seen.has(execution.id)) {
      continue;
    }
    seen.add(execution.id);
    result.push(execution);
  }

  return result;
}

function upsertExecution(
  current: ExecutionRun[],
  next: ExecutionRun,
  maxItems = MAX_CACHED_EXECUTIONS,
): ExecutionRun[] {
  const filtered = current.filter((item) => item.id !== next.id);
  return [next, ...filtered].slice(0, maxItems);
}

function removeExecutionById(
  current: ExecutionRun[],
  executionId: string,
): ExecutionRun[] {
  return current.filter((item) => item.id !== executionId);
}

function normalizeNodeResult(
  nodeResult: ExecutionNodeResult,
): NormalizedNodeResult {
  if (!isRecord(nodeResult)) {
    return {
      success: true,
      status: "success",
      data: nodeResult,
    };
  }

  const explicitStatus =
    nodeResult.status === "success" ||
    nodeResult.status === "failed" ||
    nodeResult.status === "skipped"
      ? nodeResult.status
      : nodeResult.status === "error"
        ? "failed"
        : undefined;

  const explicitSuccess =
    typeof nodeResult.success === "boolean" ? nodeResult.success : undefined;

  const error =
    typeof nodeResult.error === "string" ? nodeResult.error : undefined;

  const success =
    explicitSuccess ??
    (explicitStatus
      ? explicitStatus === "success" || explicitStatus === "skipped"
      : !error);

  return {
    ...nodeResult,
    success,
    status: explicitStatus ?? (success ? "success" : "failed"),
    error,
  };
}

function getItemCount(data: unknown): number {
  if (Array.isArray(data)) {
    return data.length;
  }

  if (data === null || data === undefined) {
    return 0;
  }

  return 1;
}

export function useExecutionHistory(
  workflowId: string | null,
  filters: ExecutionFilters = {},
) {
  const [executions, setExecutions] = useState<ExecutionRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionRun | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(false);
  const fetchRequestIdRef = useRef(0);
  const loadMoreRequestIdRef = useRef(0);
  const selectedExecutionIdRef = useRef<string | null>(null);

  const statusFilter = filters.status;
  const dateFromFilter = filters.dateFrom;
  const dateToFilter = filters.dateTo;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedExecutionIdRef.current = selectedExecution?.id ?? null;
  }, [selectedExecution]);

  const matchesFilters = useCallback(
    (execution: ExecutionRun) =>
      matchesExecutionFilters(execution, {
        status: statusFilter,
        dateFrom: dateFromFilter,
        dateTo: dateToFilter,
      }),
    [statusFilter, dateFromFilter, dateToFilter],
  );

  const fetchExecutions = useCallback(async () => {
    if (!workflowId) {
      if (isMountedRef.current) {
        setExecutions([]);
        setHasMore(false);
        setSelectedExecution(null);
        setError(null);
      }
      return;
    }

    const requestId = ++fetchRequestIdRef.current;

    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const query = applyFiltersToQuery(workflowId, {
        status: statusFilter,
        dateFrom: dateFromFilter,
        dateTo: dateToFilter,
      });

      const { data, error: queryError } = await query
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (queryError) {
        throw queryError;
      }

      if (!isMountedRef.current || requestId !== fetchRequestIdRef.current) {
        return;
      }

      const results = dedupeById((data as ExecutionRun[]) ?? []);
      setExecutions(results);
      setHasMore(results.length === PAGE_SIZE);

      setSelectedExecution((prev) => {
        if (!prev) {
          return null;
        }

        const updatedSelected = results.find((item) => item.id === prev.id);
        if (updatedSelected) {
          return updatedSelected;
        }

        return matchesExecutionFilters(prev, {
          status: statusFilter,
          dateFrom: dateFromFilter,
          dateTo: dateToFilter,
        })
          ? prev
          : null;
      });

      setError(null);
    } catch (err) {
      if (!isMountedRef.current || requestId !== fetchRequestIdRef.current) {
        return;
      }

      console.error("Failed to fetch executions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch executions",
      );
    } finally {
      if (isMountedRef.current && requestId === fetchRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [workflowId, statusFilter, dateFromFilter, dateToFilter]);

  const loadMore = useCallback(async () => {
    if (!workflowId || !hasMore || loadingMore) {
      return;
    }

    const requestId = ++loadMoreRequestIdRef.current;

    if (isMountedRef.current) {
      setLoadingMore(true);
      setError(null);
    }

    try {
      const query = applyFiltersToQuery(workflowId, {
        status: statusFilter,
        dateFrom: dateFromFilter,
        dateTo: dateToFilter,
      });

      const { data, error: queryError } = await query
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .range(executions.length, executions.length + PAGE_SIZE - 1);

      if (queryError) {
        throw queryError;
      }

      if (!isMountedRef.current || requestId !== loadMoreRequestIdRef.current) {
        return;
      }

      const nextPage = (data as ExecutionRun[]) ?? [];

      setExecutions((prev) => dedupeById([...prev, ...nextPage]));
      setHasMore(nextPage.length === PAGE_SIZE);
    } catch (err) {
      if (!isMountedRef.current || requestId !== loadMoreRequestIdRef.current) {
        return;
      }

      console.error("Failed to load more executions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load more executions",
      );
    } finally {
      if (isMountedRef.current && requestId === loadMoreRequestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [
    workflowId,
    hasMore,
    loadingMore,
    executions.length,
    statusFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  useEffect(() => {
    void fetchExecutions();
  }, [fetchExecutions]);

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    const channel = supabase
      .channel(`workflow-runs-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_runs",
          filter: `workflow_id=eq.${workflowId}`,
        },
        (payload) => {
          if (!isMountedRef.current) {
            return;
          }

          if (payload.eventType === "DELETE") {
            const deletedId = String(
              (payload.old as { id?: string } | null)?.id ?? "",
            );

            if (!deletedId) {
              return;
            }

            setExecutions((prev) => removeExecutionById(prev, deletedId));

            if (selectedExecutionIdRef.current === deletedId) {
              setSelectedExecution(null);
            }

            return;
          }

          const execution = payload.new as ExecutionRun | null;
          if (!execution) {
            return;
          }

          if (!matchesFilters(execution)) {
            setExecutions((prev) => removeExecutionById(prev, execution.id));

            if (selectedExecutionIdRef.current === execution.id) {
              setSelectedExecution(null);
            }

            return;
          }

          setExecutions((prev) => upsertExecution(prev, execution));

          if (selectedExecutionIdRef.current === execution.id) {
            setSelectedExecution(execution);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workflowId, matchesFilters]);

  useEffect(() => {
    if (!autoRefresh || !workflowId) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchExecutions();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoRefresh, workflowId, fetchExecutions]);

  useEffect(() => {
    if (selectedExecution && !matchesFilters(selectedExecution)) {
      setSelectedExecution(null);
    }
  }, [selectedExecution, matchesFilters]);

  const getDuration = useCallback((execution: ExecutionRun): string => {
    if (!execution.completed_at || !execution.started_at) {
      return "—";
    }

    const start = new Date(execution.started_at).getTime();
    const end = new Date(execution.completed_at).getTime();
    const durationMs = Math.max(0, end - start);

    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }

    return `${(durationMs / 1000).toFixed(1)}s`;
  }, []);

  const getNodeExecutions = useCallback(
    (execution: ExecutionRun): NodeExecutionLog[] => {
      const payload = execution.result;
      if (!payload) {
        return [];
      }

      const executionOrder = Array.isArray(payload.executionOrder)
        ? payload.executionOrder.filter(
            (nodeId): nodeId is string =>
              typeof nodeId === "string" && nodeId.length > 0,
          )
        : [];

      const nodeResults = isRecord(payload.nodeResults)
        ? (payload.nodeResults as Record<string, ExecutionNodeResult>)
        : {};

      if (
        executionOrder.length === 0 ||
        Object.keys(nodeResults).length === 0
      ) {
        return [];
      }

      const totalDurationMs =
        execution.completed_at && execution.started_at
          ? Math.max(
              0,
              new Date(execution.completed_at).getTime() -
                new Date(execution.started_at).getTime(),
            )
          : 0;

      const estimatedDurationMs =
        executionOrder.length > 0
          ? Math.round(totalDurationMs / executionOrder.length)
          : 0;

      const nodeExecutions: NodeExecutionLog[] = [];

      for (const nodeId of executionOrder) {
        const rawOutput = nodeResults[nodeId];
        if (rawOutput === undefined) {
          continue;
        }

        const output = normalizeNodeResult(rawOutput);

        nodeExecutions.push({
          nodeId,
          nodeName: nodeId,
          startedAt: execution.started_at,
          completedAt: execution.completed_at ?? execution.started_at,
          durationMs: estimatedDurationMs,
          status: output.status,
          input: null,
          output,
          itemCount: getItemCount(output.data),
          error: output.error,
        });
      }

      return nodeExecutions;
    },
    [],
  );

  return {
    executions,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    selectedExecution,
    setSelectedExecution,
    autoRefresh,
    setAutoRefresh,
    refresh: fetchExecutions,
    getDuration,
    getNodeExecutions,
    error,
  };
}
