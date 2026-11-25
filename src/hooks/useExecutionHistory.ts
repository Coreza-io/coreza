/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { normalizePersistedNodeResult } from "@/utils/persistedNodeResult";

const PAGE_SIZE = 20;
const MAX_CACHED_EXECUTIONS = 200;
const BAR_PARENT = "scope_snapshot->>backtestParentRunId";
const BAR_SYMBOL = "scope_snapshot->>backtestBarSymbol";
const BAR_TIME = "scope_snapshot->>backtestBarTime";
const SUMMARY_COLUMNS = `id,workflow_id,status,started_at,completed_at,error_message,initiated_by,node_count,edge_count,parent_run_id:${BAR_PARENT},bar_symbol:${BAR_SYMBOL},bar_time:${BAR_TIME}`;
export type ExecutionSummary = Omit<ExecutionRun, "result" | "nodes" | "edges" | "node_clusters" | "scope_snapshot">;

export type ExecutionStatus =
  | "all"
  | "success"
  | "failed"
  | "running"
  | "pending"
  | "cancelled";

export type ExecutionHistorySort = "newest" | "oldest";

export interface ExecutionFilters {
  status?: ExecutionStatus;
  sort?: ExecutionHistorySort;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  barSymbol?: string;
  barFrom?: string;
  barTo?: string;
}

export interface NodeExecutionLog {
  nodeId: string;
  nodeName: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
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
  timing?: Record<string, { avgMs: number; totalMs: number; count: number }>;
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
  node_clusters: unknown;
  scope_snapshot?: { executionMode?: string; barHistory?: boolean } | null;
  node_count: number | null;
  edge_count: number | null;
  parent_run_id: string | null;
  bar_symbol: string | null;
  bar_time: string | null;
}

// Compare only the selected run on refresh, with a bounded traversal of persisted JSON.
// If the budget is exceeded, accept the fresh record so real updates are never hidden.
function sameExecution(previous: ExecutionRun, next: ExecutionRun): boolean {
  let remaining = 20000;
  const equal = (a: unknown, b: unknown, depth = 0): boolean => {
    if (--remaining < 0 || depth > 64) return false;
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) &&
      equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1));
  };
  const fields: (keyof ExecutionRun)[] = [
    "id", "workflow_id", "status", "started_at", "completed_at", "error_message",
    "result", "initiated_by", "nodes", "edges", "node_clusters", "node_count", "edge_count", "parent_run_id", "bar_symbol", "bar_time",
  ];
  return fields.every(field => equal(previous[field], next[field]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toExclusiveDateTo(date: Date): Date {
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return end;
}

function filtersBars(filters: ExecutionFilters): boolean {
  return Boolean(filters.barSymbol || filters.barFrom || filters.barTo);
}

function matchesExecutionFilters(
  execution: ExecutionSummary,
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

  if (filtersBars(filters)) {
    if (!execution.bar_time || (filters.barSymbol && execution.bar_symbol !== filters.barSymbol)) return false;
    const barTime = Date.parse(execution.bar_time);
    if (filters.barFrom && barTime < Date.parse(filters.barFrom)) return false;
    if (filters.barTo && barTime > Date.parse(filters.barTo)) return false;
  }
  return true;
}

function applyFiltersToQuery(workflowId: string, filters: ExecutionFilters) {
  let query = supabase
    .from("workflow_runs")
    .select(SUMMARY_COLUMNS)
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

  if (filtersBars(filters)) query = query.not(BAR_TIME, "is", null);
  if (filters.barSymbol) query = query.eq(BAR_SYMBOL, filters.barSymbol);
  if (filters.barFrom) query = query.gte(BAR_TIME, filters.barFrom);
  if (filters.barTo) query = query.lte(BAR_TIME, filters.barTo);
  return query;
}

function barMetadata(snapshot: unknown) {
  const fields = isRecord(snapshot) ? snapshot : {};
  return {
    parent_run_id: typeof fields.backtestParentRunId === "string" ? fields.backtestParentRunId : null,
    bar_symbol: typeof fields.backtestBarSymbol === "string" ? fields.backtestBarSymbol : null,
    bar_time: typeof fields.backtestBarTime === "string" ? fields.backtestBarTime : null,
  };
}

const toSummary = (run: ExecutionSummary): ExecutionSummary => ({
  id: run.id, workflow_id: run.workflow_id, status: run.status, started_at: run.started_at,
  completed_at: run.completed_at, error_message: run.error_message, initiated_by: run.initiated_by,
  node_count: run.node_count, edge_count: run.edge_count,
  parent_run_id: run.parent_run_id, bar_symbol: run.bar_symbol, bar_time: run.bar_time,
});

type HistoryTime = "started_at" | "bar_time";

function compareSummaries(a: ExecutionSummary, b: ExecutionSummary, timeColumn: HistoryTime): number {
  const aTime = a[timeColumn] ?? "";
  const bTime = b[timeColumn] ?? "";
  if (aTime !== bTime) return aTime > bTime ? -1 : 1;
  return b.id.localeCompare(a.id);
}

function mergeSummaries(
  current: ExecutionSummary[], incoming: ExecutionSummary[], compare: (a: ExecutionSummary, b: ExecutionSummary) => number,
): ExecutionSummary[] {
  const byId = new Map(current.map(run => [run.id, run]));
  for (const run of incoming) {
    const previous = byId.get(run.id);
    const next = toSummary(run);
    byId.set(run.id, previous && Object.keys(next).every(key => previous[key as keyof ExecutionSummary] === next[key as keyof ExecutionSummary]) ? previous : next);
  }
  return [...byId.values()].sort(compare);
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
  enabled = true,
) {
  const { user, session } = useAuth();
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const [selectedExecution, publishSelectedExecution] = useState<ExecutionRun | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, barSymbol, barFrom, barTo } = filters;
  const ascending = filters.sort === "oldest";
  const dateFrom = filters.dateFrom?.getTime();
  const dateTo = filters.dateTo?.getTime();
  const dataScope = useMemo(() => ({}), [user?.id, workflowId, status, dateFrom, dateTo, barSymbol, barFrom, barTo]);
  const previousDataScope = useRef<object | null>(null);
  const previousAscending = useRef(ascending);
  const scope = useMemo(() => ({ owner: user?.id, workflowId, status, dateFrom, dateTo, barSymbol, barFrom, barTo, ascending, enabled }), [user?.id, workflowId, status, dateFrom, dateTo, barSymbol, barFrom, barTo, ascending, enabled]);
  const currentScope = useRef<typeof scope | null>(scope);
  currentScope.current = scope;
  const selection = useRef<string | null>(null);
  const detailRequest = useRef(0);
  const details = useRef(new Map<string, ExecutionRun>());
  const cursor = useRef<ExecutionSummary | null>(null);
  const firstRow = useRef<ExecutionSummary | null>(null);
  const firstFlight = useRef<object | null>(null);
  const pageFlight = useRef<object | null>(null);
  const detailFlight = useRef<{ id: string; promise: Promise<void>; queued: boolean } | null>(null);
  const normalizedFilters = useMemo(() => ({ status, dateFrom: dateFrom === undefined ? undefined : new Date(dateFrom), dateTo: dateTo === undefined ? undefined : new Date(dateTo), barSymbol, barFrom, barTo }), [status, dateFrom, dateTo, barSymbol, barFrom, barTo]);
  const timeColumn: HistoryTime = filtersBars(normalizedFilters) ? "bar_time" : "started_at";
  const timeQueryColumn = timeColumn === "bar_time" ? BAR_TIME : timeColumn;
  const compare = useCallback((a: ExecutionSummary, b: ExecutionSummary) =>
    ascending ? compareSummaries(b, a, timeColumn) : compareSummaries(a, b, timeColumn), [ascending, timeColumn]);
  const isCurrent = useCallback(() => currentScope.current === scope, [scope]);

  const loadDetail = useCallback((runId: string, force = false): Promise<void> => {
    if (!isCurrent() || !scope.enabled || !scope.owner || !scope.workflowId) return Promise.resolve();
    if (detailFlight.current?.id === runId) { detailFlight.current.queued ||= force; return detailFlight.current.promise; }
    const cached = details.current.get(runId);
    if (cached && !force) { setDetailLoading(false); publishSelectedExecution(cached); return Promise.resolve(); }
    const request = ++detailRequest.current;
    setDetailLoading(true); setError(null);
    const promise = (async () => {
      try {
        const { data, error: queryError } = await supabase.from("workflow_runs")
          .select("*").eq("workflow_id", scope.workflowId!).eq("id", runId).single();
        if (!isCurrent() || request !== detailRequest.current || selection.current !== runId) return;
        if (queryError) throw queryError;
        let next: ExecutionRun = { ...(data as Omit<ExecutionRun, keyof ReturnType<typeof barMetadata>>), ...barMetadata(data?.scope_snapshot) };
        if (next.parent_run_id) {
          const { data: graph, error: graphError } = await supabase.from("workflow_runs")
            .select("nodes,edges,node_clusters")
            .eq("workflow_id", scope.workflowId!).eq("id", next.parent_run_id).is(BAR_PARENT, null)
            .maybeSingle();
          if (!isCurrent() || request !== detailRequest.current || selection.current !== runId) return;
          if (graphError || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
            throw new Error("The backtest graph snapshot is unavailable");
          }
          next = { ...next, nodes: graph.nodes, edges: graph.edges, node_clusters: graph.node_clusters };
        }
        if (!matchesExecutionFilters(next, normalizedFilters)) {
          details.current.delete(runId);
          setExecutions(previous => previous.filter(run => run.id !== runId));
          selection.current = null; setSelectedExecutionId(null); publishSelectedExecution(null);
          return;
        }
        const previous = details.current.get(runId);
        const detail = previous && sameExecution(previous, next) ? previous : next;
        details.current.delete(runId);
        details.current.set(runId, detail);
        while (details.current.size > 3) details.current.delete(details.current.keys().next().value!);
        publishSelectedExecution(detail);
      } catch (err) {
        if (isCurrent() && request === detailRequest.current) setError(err instanceof Error ? err.message : "Failed to load execution detail");
      } finally {
        if (isCurrent() && request === detailRequest.current) {
          const queued = detailFlight.current?.queued;
          setDetailLoading(false); detailFlight.current = null;
          if (queued && selection.current === runId) void loadDetail(runId, true);
        }
      }
    })();
    detailFlight.current = { id: runId, promise, queued: false };
    return promise;
  }, [scope, isCurrent, normalizedFilters]);

  const setSelectedExecution = useCallback((run: ExecutionSummary | null) => {
    if (!isCurrent()) return Promise.resolve();
    if (run && selection.current === run.id && detailFlight.current?.id === run.id) return detailFlight.current.promise;
    selection.current = run?.id ?? null;
    setSelectedExecutionId(run?.id ?? null);
    detailRequest.current += 1;
    detailFlight.current = null;
    if (!run) { publishSelectedExecution(null); setDetailLoading(false); return Promise.resolve(); }
    publishSelectedExecution(details.current.get(run.id) ?? null);
    // Selection is an explicit refresh boundary, even for cached terminal runs.
    return loadDetail(run.id, true);
  }, [loadDetail, isCurrent]);

  const fetchExecutions = useCallback(async (manual = false) => {
    if (!isCurrent() || !enabled || !workflowId || !scope.owner || firstFlight.current) return;
    if (manual) { pageFlight.current = null; setLoadingMore(false); }
    const flight = {}; firstFlight.current = flight;
    setLoading(true); setError(null);
    try {
      const { data, error: queryError } = await applyFiltersToQuery(workflowId, normalizedFilters)
        .order(timeQueryColumn, { ascending }).order("id", { ascending }).limit(PAGE_SIZE);
      if (!isCurrent() || firstFlight.current !== flight) return;
      if (queryError) throw queryError;
      const rows = (data ?? []) as unknown as ExecutionSummary[];
      const boundary = rows[rows.length - 1];
      const hasGap = boundary && firstRow.current && compare(boundary, firstRow.current) < 0;
      firstRow.current = rows[0] ?? null;
      if (manual || !cursor.current || rows.length < PAGE_SIZE || hasGap) {
        pageFlight.current = null;
        setLoadingMore(false);
        setExecutions(mergeSummaries([], rows, compare));
        cursor.current = boundary ?? null;
        setHasMore(rows.length === PAGE_SIZE);
      } else {
        setExecutions(previous => {
          // A first-page load is authoritative for its covered time range.
          // Keep subsequent pages and retain the window nearest the pagination cursor.
          const retained = previous.filter(run => compare(run, boundary) > 0);
          return mergeSummaries(retained, rows, compare).slice(-MAX_CACHED_EXECUTIONS);
        });
      }
      const selectedId = selection.current;
      const selectedSummary = rows.find(row => row.id === selectedId);
      const selectedDetail = selectedId ? details.current.get(selectedId) : undefined;
      if (selectedId && (manual || (selectedDetail && ["pending", "queued", "running"].includes(selectedDetail.status)) || (selectedSummary && selectedDetail && selectedSummary.status !== selectedDetail.status))) {
        await loadDetail(selectedId, true);
      }
    } catch (err) {
      if (isCurrent() && firstFlight.current === flight) setError(err instanceof Error ? err.message : "Failed to fetch executions");
    } finally {
      if (isCurrent() && firstFlight.current === flight) { firstFlight.current = null; setLoading(false); }
    }
  }, [enabled, workflowId, scope.owner, normalizedFilters, ascending, compare, timeQueryColumn, isCurrent, loadDetail]);

  const clearHistory = useCallback(async (backtestRunId?: string): Promise<number> => {
    const token = session?.access_token;
    if (!workflowId || !token || !isCurrent()) throw new Error("Sign in to clear execution history");

    const query = backtestRunId ? `?backtestRunId=${encodeURIComponent(backtestRunId)}` : "";
    try {
      const response = await apiClient.delete(`/workflows/${encodeURIComponent(workflowId)}/runs${query}`, token);
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.deleted !== "number") {
        throw new Error(result?.message || "Failed to clear execution history");
      }
      if (isCurrent()) {
        await setSelectedExecution(null);
        details.current.clear();
      }
      return result.deleted;
    } finally {
      if (isCurrent()) {
        // Supersede any fetch that started before the deletion.
        firstFlight.current = null;
        await fetchExecutions(true);
      }
    }
  }, [workflowId, session?.access_token, isCurrent, setSelectedExecution, fetchExecutions]);

  const loadMore = useCallback(async () => {
    if (!isCurrent() || !enabled || !workflowId || !scope.owner || !hasMore || pageFlight.current || firstFlight.current || !cursor.current) return;
    const flight = {}; pageFlight.current = flight;
    const after = cursor.current;
    setLoadingMore(true);
    try {
      const afterTime = after[timeColumn];
      const operator = ascending ? "gt" : "lt";
      const { data, error: queryError } = await applyFiltersToQuery(workflowId, normalizedFilters)
        .or(`${timeQueryColumn}.${operator}.${afterTime},and(${timeQueryColumn}.eq.${afterTime},id.${operator}.${after.id})`)
        .order(timeQueryColumn, { ascending }).order("id", { ascending }).limit(PAGE_SIZE);
      if (!isCurrent() || pageFlight.current !== flight) return;
      if (queryError) throw queryError;
      const rows = (data ?? []) as unknown as ExecutionSummary[];
      // Keep the cursor independent of retained rows so eviction cannot skip or repeat a page.
      if (rows.length) cursor.current = rows[rows.length - 1]!;
      setExecutions(previous => mergeSummaries(previous, rows, compare).slice(-MAX_CACHED_EXECUTIONS));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      if (isCurrent() && pageFlight.current === flight) setError(err instanceof Error ? err.message : "Failed to load more executions");
    } finally {
      if (isCurrent() && pageFlight.current === flight) { pageFlight.current = null; setLoadingMore(false); }
    }
  }, [enabled, workflowId, scope.owner, hasMore, normalizedFilters, ascending, compare, timeColumn, timeQueryColumn, isCurrent]);

  useEffect(() => {
    currentScope.current = scope;
    detailRequest.current += 1;
    firstFlight.current = pageFlight.current = null; detailFlight.current = null;
    const filtersChanged = previousDataScope.current !== dataScope;
    if (filtersChanged) {
      previousDataScope.current = dataScope;
      selection.current = null; setSelectedExecutionId(null); details.current.clear(); publishSelectedExecution(null);
    }
    if (filtersChanged || previousAscending.current !== ascending) {
      previousAscending.current = ascending;
      cursor.current = firstRow.current = null;
      setExecutions([]); setHasMore(false); setError(null);
    }
    setLoading(false); setLoadingMore(false); setDetailLoading(false);
    void fetchExecutions();
    if (enabled && selection.current) void loadDetail(selection.current, true);
    return () => { if (currentScope.current === scope) currentScope.current = null; };
  }, [scope, dataScope, ascending, fetchExecutions, enabled, loadDetail]);

  useEffect(() => {
    if (!enabled || !workflowId || !scope.owner) return;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let summaryTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshAfterBatch = () => {
      summaryTimer = null;
      if (disposed || !isCurrent()) return;
      if (firstFlight.current) summaryTimer = setTimeout(refreshAfterBatch, 300);
      else void fetchExecutions(true);
    };
    const channel = supabase.channel(`workflow-runs-${scope.owner}-${workflowId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "workflow_runs", filter: `workflow_id=eq.${workflowId}`,
    }, payload => {
      if (disposed || !isCurrent()) return;
      const id = String((payload.eventType === "DELETE" ? payload.old : payload.new)?.id ?? "");
      if (payload.eventType === "DELETE") {
        const selected = selection.current ? details.current.get(selection.current) : undefined;
        for (const [runId, run] of details.current) {
          if (runId === id || run.parent_run_id === id) details.current.delete(runId);
        }
        setExecutions(previous => previous.filter(run => run.id !== id && run.parent_run_id !== id));
        if (selection.current === id || selected?.parent_run_id === id) void setSelectedExecution(null);
        return;
      }
      // Retain only summary fields from full realtime payloads.
      const bar = barMetadata(payload.new.scope_snapshot);
      if (bar.parent_run_id) return;
      const summary = toSummary({ ...payload.new as ExecutionRun, ...bar });
      if (payload.eventType === "UPDATE" && payload.new.scope_snapshot?.barHistory === true
        && summary.completed_at && !summaryTimer) {
        summaryTimer = setTimeout(refreshAfterBatch, 300);
      }
      if (matchesExecutionFilters(summary, normalizedFilters)) {
        // Leave rows beyond the loaded window to pagination, especially new runs in oldest-first order.
        if (!hasMoreRef.current || !cursor.current || compare(summary, cursor.current) <= 0) {
          setExecutions(previous => mergeSummaries(previous, [summary], compare).slice(-MAX_CACHED_EXECUTIONS));
        }
      } else {
        setExecutions(previous => previous.filter(run => run.id !== id));
        if (selection.current === id) void setSelectedExecution(null);
      }
      if (selection.current !== id) details.current.delete(id);
      if (selection.current === id && !refreshTimer) refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!disposed && isCurrent() && selection.current) void loadDetail(selection.current, true);
      }, 100);
    }).subscribe();
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (summaryTimer) clearTimeout(summaryTimer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, workflowId, scope.owner, isCurrent, normalizedFilters, compare, loadDetail, setSelectedExecution, fetchExecutions]);

  useEffect(() => {
    if (!enabled || !autoRefresh || !workflowId) return;
    const interval = window.setInterval(() => { if (!document.hidden) void fetchExecutions(); }, 5000);
    return () => window.clearInterval(interval);
  }, [enabled, autoRefresh, workflowId, fetchExecutions]);

  const getDuration = useCallback((execution: ExecutionSummary): string => {
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

      if (Object.keys(nodeResults).length === 0) {
        return [];
      }

      const orderedNodeIds = [...new Set([
        ...executionOrder,
        ...Object.keys(nodeResults),
      ])];

      const timing = isRecord(payload.timing)
        ? (payload.timing as Record<
            string,
            { avgMs: number; totalMs: number; count: number }
          >)
        : {};

      const nodeExecutions: NodeExecutionLog[] = [];

      for (const nodeId of orderedNodeIds) {
        if (!Object.prototype.hasOwnProperty.call(nodeResults, nodeId)) continue;
        const rawOutput = nodeResults[nodeId];
        const output = normalizePersistedNodeResult(rawOutput);

        nodeExecutions.push({
          nodeId,
          nodeName: nodeId,
          startedAt: execution.started_at,
          completedAt: execution.completed_at ?? execution.started_at,
          durationMs:
            typeof timing[nodeId]?.totalMs === "number"
              ? Number(timing[nodeId].totalMs.toFixed(2))
              : undefined,
          status: output.status === "error" ? "failed" : output.status === "skipped" ? "skipped" : "success",
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
    selectedExecutionId,
    setSelectedExecution,
    autoRefresh,
    setAutoRefresh,
    detailLoading,
    refresh: () => fetchExecutions(true),
    clearHistory,
    getDuration,
    getNodeExecutions,
    error,
  };
}
