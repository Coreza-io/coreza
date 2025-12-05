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

export interface NodeExecutionLog {
  nodeId: string;
  nodeName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  input: any;
  output: any;
  itemCount: number;
  error?: string;
}

export interface ExecutionRun {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  result: {
    success?: boolean;
    result?: Record<string, any>;
    nodeExecutions?: NodeExecutionLog[];
    executionOrder?: string[];
    error?: string;
  } | null;
  initiated_by: string | null;
}

export function useExecutionHistory(workflowId: string | null) {
  const [executions, setExecutions] = useState<ExecutionRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<ExecutionRun | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchExecutions = useCallback(async () => {
    if (!workflowId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("workflow_runs")
        .select("*")
        .eq("workflow_id", workflowId)
        .order("started_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      const results = (data as ExecutionRun[]) || [];
      setExecutions(results);
      setHasMore(results.length === PAGE_SIZE);
    } catch (error) {
      console.error("Failed to fetch executions:", error);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const loadMore = useCallback(async () => {
    if (!workflowId || !hasMore || loadingMore) return;
    
    setLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from("workflow_runs")
        .select("*")
        .eq("workflow_id", workflowId)
        .order("started_at", { ascending: false })
        .range(executions.length, executions.length + PAGE_SIZE - 1);

      if (error) throw error;
      
      const newData = (data as ExecutionRun[]) || [];
      setExecutions(prev => [...prev, ...newData]);
      setHasMore(newData.length === PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more executions:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [workflowId, hasMore, loadingMore, executions.length]);

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
          if (payload.eventType === "INSERT") {
            setExecutions((prev) => [payload.new as ExecutionRun, ...prev].slice(0, 50));
          } else if (payload.eventType === "UPDATE") {
            setExecutions((prev) =>
              prev.map((exec) =>
                exec.id === payload.new.id ? (payload.new as ExecutionRun) : exec
              )
            );
            // Update selected execution if it's the one being updated
            if (selectedExecution?.id === payload.new.id) {
              setSelectedExecution(payload.new as ExecutionRun);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workflowId, selectedExecution?.id]);

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

  const getNodeExecutions = useCallback((execution: ExecutionRun): NodeExecutionLog[] => {
    if (!execution.result) return [];
    
    // Check if nodeExecutions exists in result
    if (execution.result.nodeExecutions) {
      return execution.result.nodeExecutions;
    }
    
    // Fallback: convert result object to execution logs
    const resultData = execution.result.result || execution.result;
    if (typeof resultData === "object" && resultData !== null) {
      return Object.entries(resultData).map(([nodeId, output]) => ({
        nodeId,
        nodeName: nodeId,
        startedAt: execution.started_at,
        completedAt: execution.completed_at || execution.started_at,
        durationMs: 0,
        status: "success" as const,
        input: {},
        output,
        itemCount: Array.isArray(output) ? output.length : 1,
      }));
    }
    
    return [];
  }, []);

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
  };
}
