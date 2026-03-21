/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;
const MAX_CACHED_EXECUTIONS = PAGE_SIZE * 2;

export interface ExecutionFilters {
  status?: "all" | "success" | "failed" | "running" | "pending" | "cancelled";
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
      data?: unknown;
      error?: string;
      [key: string]: unknown;
    }
  | unknown;

export interface ExecutionResultPayload {
  success?: boolean;
  result?: Record<string, ExecutionNodeResult>;
  nodeExecutions?: NodeExecutionLog[];
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
  nodes: any[] | null;
  edges: any[] | null;
  node_count: number | null;
  edge_count: number | null;
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

  const matchesFilters = useCallback(
    (execution: ExecutionRun) => {
      if (
        filters.status &&
        filters.status !== "all" &&
        execution.status !== filters.status
      ) {
        return false;
      }

      if (filters.dateFrom) {
        const startDate = new Date(execution.started_at);
        if (startDate < filters.dateFrom) return false;
      }

      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setDate(endDate.getDate() + 1);
        const startDate = new Date(execution.started_at);
        if (startDate >= endDate) return false;
      }

      return true;
    },
    [filters.dateFrom, filters.dateTo, filters.status],
  );

  const fetchExecutions = useCallback(async () => {
    if (!workflowId) return;

    setLoading(true);
    setError(null);
    try {
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
        const endDate = new Date(filters.dateTo);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt("started_at", endDate.toISOString());
      }

      const { data, error } = await query
        .order("started_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      const results = (data as ExecutionRun[]) || [];
      setExecutions(results);
      setHasMore(results.length === PAGE_SIZE);
      setError(null);
    } catch (error) {
      console.error("Failed to fetch executions:", error);
      setError(
        error instanceof Error ? error.message : "Failed to fetch executions",
      );
    } finally {
      setLoading(false);
    }
  }, [workflowId, filters.status, filters.dateFrom, filters.dateTo]);

  const loadMore = useCallback(async () => {
    if (!workflowId || !hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
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
        const endDate = new Date(filters.dateTo);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt("started_at", endDate.toISOString());
      }

      const { data, error } = await query
        .order("started_at", { ascending: false })
        .range(executions.length, executions.length + PAGE_SIZE - 1);

      if (error) throw error;

      const newData = (data as ExecutionRun[]) || [];
      setExecutions((prev) => [...prev, ...newData]);
      setHasMore(newData.length === PAGE_SIZE);
      setError(null);
    } catch (error) {
      console.error("Failed to load more executions:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load more executions",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [
    workflowId,
    hasMore,
    loadingMore,
    executions.length,
    filters.status,
    filters.dateFrom,
    filters.dateTo,
  ]);

  // Initial fetch
  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  // Real-time subscription
  useEffect(() => {
    if (!workflowId) return;

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
          const execution = payload.new as ExecutionRun;

          if (payload.eventType === "INSERT") {
            if (!matchesFilters(execution)) return;

            setExecutions((prev) =>
              [execution, ...prev].slice(0, MAX_CACHED_EXECUTIONS),
            );
          } else if (payload.eventType === "UPDATE") {
            if (!matchesFilters(execution)) {
              setExecutions((prev) =>
                prev.filter((exec) => exec.id !== execution.id),
              );
              if (selectedExecution?.id === execution.id) {
                setSelectedExecution(null);
              }
              return;
            }

            setExecutions((prev) => {
              const exists = prev.some((exec) => exec.id === execution.id);
              if (exists) {
                return prev.map((exec) =>
                  exec.id === execution.id ? execution : exec,
                );
              }
              return [execution, ...prev].slice(0, MAX_CACHED_EXECUTIONS);
            });
            // Update selected execution if it's the one being updated
            if (selectedExecution?.id === payload.new.id) {
              setSelectedExecution(payload.new as ExecutionRun);
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workflowId, selectedExecution?.id, matchesFilters]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchExecutions, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchExecutions]);

  const getDuration = useCallback((execution: ExecutionRun): string => {
    if (!execution.completed_at || !execution.started_at) return "—";
    const start = new Date(execution.started_at).getTime();
    const end = new Date(execution.completed_at).getTime();
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }, []);

  const getNodeExecutions = useCallback(
    (execution: ExecutionRun): NodeExecutionLog[] => {
      if (!execution.result) return [];

      // Check if nodeExecutions exists in result
      if (
        execution.result.nodeExecutions &&
        Array.isArray(execution.result.nodeExecutions)
      ) {
        return execution.result.nodeExecutions;
      }

      // Enhanced fallback: extract from result object with better defaults
      let resultData = execution.result.result as
        | Record<string, ExecutionNodeResult>
        | undefined;
      let executionOrder = execution.result.executionOrder;

      if (
        !resultData &&
        execution.result.data &&
        typeof execution.result.data === "object"
      ) {
        const innerData = execution.result.data as Record<string, unknown>;
        resultData = innerData.result as
          | Record<string, ExecutionNodeResult>
          | undefined;
        executionOrder =
          executionOrder || (innerData.executionOrder as string[] | undefined);
      }

      resultData = (resultData ?? execution.result) as Record<
        string,
        ExecutionNodeResult
      >;
      executionOrder = executionOrder || Object.keys(resultData || {});

      if (typeof resultData !== "object" || resultData === null) {
        return [];
      }

      // Calculate total duration for distribution
      const totalDuration =
        execution.completed_at && execution.started_at
          ? new Date(execution.completed_at).getTime() -
            new Date(execution.started_at).getTime()
          : 0;
      const nodeCount = executionOrder.length || 1;
      const estimatedDurationPerNode = Math.round(totalDuration / nodeCount);

      return executionOrder
        .filter((nodeId) => nodeId && typeof nodeId === "string")
        .map((nodeId, index) => {
          const output = resultData[nodeId];
          const outputData =
            output && typeof output === "object" && "data" in output
              ? (output as { data?: unknown }).data
              : output;

          // Derive input from previous node's output
          const prevNodeId = index > 0 ? executionOrder[index - 1] : null;
          const prevOutput = prevNodeId ? resultData[prevNodeId] : null;
          const inputData =
            prevOutput && typeof prevOutput === "object" && "data" in prevOutput
              ? (prevOutput as { data?: unknown }).data
              : (prevOutput ?? {});

          // Determine status based on execution result
          let status: "success" | "failed" | "skipped" = "success";
          if (execution.status === "failed") {
            // If execution failed, mark the last node as failed
            status = index === executionOrder.length - 1 ? "failed" : "success";
          }

          // If output is already normalized, respect its shape
          if (
            output &&
            typeof output === "object" &&
            "success" in output &&
            "status" in output
          ) {
            const normalizedOutput = output as {
              success: boolean;
              status?: string;
              data?: unknown;
              error?: string;
            };

            const normalizedItemCount = Array.isArray(normalizedOutput.data)
              ? normalizedOutput.data.length
              : normalizedOutput.data !== null &&
                  normalizedOutput.data !== undefined
                ? 1
                : 0;

            return {
              nodeId,
              nodeName: nodeId,
              startedAt: execution.started_at,
              completedAt: execution.completed_at || execution.started_at,
              durationMs: estimatedDurationPerNode,
              status: normalizedOutput.success ? "success" : "failed",
              input: inputData,
              output: normalizedOutput,
              itemCount: normalizedItemCount,
              error: normalizedOutput.error,
            };
          }

          const normalizedOutput = {
            success: status === "success",
            status: status === "success" ? "success" : "error",
            data: outputData,
            error: status === "failed" ? "Execution failed" : undefined,
            meta: {
              timestamp: execution.started_at,
              nodeId,
              nodeName: nodeId,
            },
          };

          return {
            nodeId,
            nodeName: nodeId,
            startedAt: execution.started_at,
            completedAt: execution.completed_at || execution.started_at,
            durationMs: estimatedDurationPerNode,
            status,
            input: inputData,
            output: normalizedOutput,
            itemCount: Array.isArray(normalizedOutput.data)
              ? normalizedOutput.data.length
              : normalizedOutput.data !== null &&
                  normalizedOutput.data !== undefined
                ? 1
                : 0,
            error: normalizedOutput.error,
          };
        });
    },
    [],
  );

  // Clear selection when filters change and current selection no longer matches
  useEffect(() => {
    if (selectedExecution && !matchesFilters(selectedExecution)) {
      setSelectedExecution(null);
    }
  }, [matchesFilters, selectedExecution]);

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
