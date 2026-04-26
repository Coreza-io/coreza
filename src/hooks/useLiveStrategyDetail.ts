import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BacktestWithRelations,
  BacktestResultMetrics,
  BacktestTrade,
  PortfolioSnapshot,
} from "./useBacktestResults";
import { buildLiveMetrics } from "@/lib/liveMetrics";

const mapFillStatusToOrderStatus = (
  fillStatus?: string | null,
): "Partial" | "Filled" | "Cancelled" | "Rejected" | "Expired" => {
  const normalized = String(fillStatus ?? "").trim().toLowerCase();
  if (normalized === "partially_filled") return "Partial";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "expired") return "Expired";
  if (normalized === "filled" || normalized === "") return "Filled";
  return "Filled";
};

const mapLiveTradeToBacktestTrade = (
  row: any,
  workflowId: string,
  fills?: any[],
): BacktestTrade => {
  const entryOrderId = row.entry_order_id;
  const exitOrderId = row.exit_order_id;

  let orders: BacktestTrade["orders"];
  if (fills && fills.length > 0 && (entryOrderId || exitOrderId)) {
    const matchedFills = fills.filter(
      (f: any) =>
        (f.order_id === entryOrderId || f.order_id === exitOrderId),
    );
    if (matchedFills.length > 0) {
      orders = matchedFills.map((f: any) => ({
        id: f.id,
        symbol: f.symbol,
        side: f.side,
        orderType: "Market",
        fillPrice: f.price,
        quantity: f.qty,
        status: mapFillStatusToOrderStatus(f.fill_status),
        exitReason:
          f.order_id === exitOrderId ? (row.exit_reason ?? undefined) : undefined,
        time: f.event_time,
      }));
    }
  }

  const netPnl = row.net_pnl != null ? Number(row.net_pnl) : null;

  return {
    id: row.id,
    backtest_id: workflowId,
    symbol: row.symbol,
    action: row.action,
    quantity: Number(row.quantity) || 0,
    entryPrice: row.entryPrice != null ? Number(row.entryPrice) : null,
    entryTime: row.entryTime ?? null,
    exitPrice: row.exitPrice != null ? Number(row.exitPrice) : null,
    exitTime: row.exitTime ?? null,
    commission: row.commission != null ? Number(row.commission) : null,
    slippage: row.slippage != null ? Number(row.slippage) : null,
    net_pnl: netPnl,
    grossPnl: row.gross_pnl != null ? Number(row.gross_pnl) : null,
    fees: row.commission != null ? Number(row.commission) : null,
    result: netPnl != null ? (netPnl >= 0 ? "Win" : "Loss") : null,
    orders,
  };
};

const mapSnapshotToPortfolioSnapshot = (
  snapshot: any,
  workflowId: string,
): PortfolioSnapshot => ({
  id: snapshot.id,
  backtest_id: workflowId,
  date: snapshot.snapshot_at,
  cash_balance: snapshot.cash ?? snapshot.total_value_usdt ?? 0,
  stock_value: 0,
  total_value: snapshot.equity ?? snapshot.total_value_usdt ?? 0,
  daily_return: undefined,
});

/**
 * Returns live strategy detail data shaped identically to useBacktestResults
 * for seamless UI reuse (EquityCurveChart, TradesTable, PerformanceMetricsCard).
 */
export const useLiveStrategyDetail = (workflowId?: string, enabled = true) => {
  const { user } = useAuth();
  const [backtest, setBacktest] = useState<BacktestWithRelations | null>(null);
  const [metrics, setMetrics] = useState<BacktestResultMetrics | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [rawFills, setRawFills] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const activeSessionRunIdRef = useRef<string | null>(null);
  const pendingSessionRunIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!enabled || !user || !workflowId) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setRawFills([]);
      setSnapshots([]);
      activeSessionRunIdRef.current = null;
      pendingSessionRunIdRef.current = null;
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, updated_at, active_execution_id")
        .eq("user_id", user.id)
        .eq("id", workflowId)
        .single();

      if (wfErr) throw wfErr;

      setBacktest({
        id: wf.id,
        name: wf.name,
        workflow_id: wf.id,
        status: wf.is_active ? "running" : "completed",
        start_date: wf.created_at ?? "",
        end_date: wf.updated_at ?? "",
        initial_capital: 0,
        started_at: wf.created_at ?? undefined,
      } as BacktestWithRelations);

      // Use a pending session (set by immediate activation UI event) first,
      // then DB active_execution_id, then localStorage fallback.
      const dbSessionRunId: string | null = (wf as any).active_execution_id ?? null;
      const localSessionRunId =
        localStorage.getItem(`live_session_${workflowId}`) ?? null;
      const pendingSessionRunId = pendingSessionRunIdRef.current;
      const sessionRunId: string | null =
        pendingSessionRunId ?? dbSessionRunId ?? localSessionRunId;

      // Clear pending override once DB has caught up to the same session,
      // or when workflow is no longer active.
      if (
        (pendingSessionRunId && dbSessionRunId === pendingSessionRunId) ||
        !wf.is_active
      ) {
        pendingSessionRunIdRef.current = null;
      }

      // Keep localStorage aligned with DB session id when the workflow is inactive
      // so refreshes and fallback resolution stay consistent.
      if (!wf.is_active && dbSessionRunId) {
        localStorage.setItem(`live_session_${workflowId}`, dbSessionRunId);
      }

      activeSessionRunIdRef.current = sessionRunId;

      // No session means no scoped live data; return empty state to prevent cross-session mixing.
      if (!sessionRunId) {
        setTrades([]);
        setRawFills([]);
        setSnapshots([]);
        setMetrics(
          buildLiveMetrics(undefined, [], []) as BacktestResultMetrics,
        );
        return;
      }

      // Fetch live_trades, live_fills, and cash_snapshots in parallel
      const tradesQuery = supabase
        .from("live_trades" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId)
        .eq("execution_id", sessionRunId)
        .order("exitTime" as any, { ascending: true });

      const fillsQuery = supabase
        .from("live_fills" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId)
        .eq("execution_id", sessionRunId)
        .order("event_time", { ascending: true });

      const snapshotsQuery = supabase
        .from("cash_snapshots" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId)
        .eq("execution_id", sessionRunId)
        .order("snapshot_at", { ascending: true });

      const [
        { data: liveTradesData, error: liveTradesErr },
        { data: fillsData, error: fillsErr },
        { data: snapshotsData, error: snapshotsErr },
      ] = await Promise.all([tradesQuery, fillsQuery, snapshotsQuery]);

      if (liveTradesErr) throw liveTradesErr;
      if (fillsErr) throw fillsErr;
      if (snapshotsErr) throw snapshotsErr;

      const rawFillsAll = (fillsData ?? []) as any[];
      setRawFills(rawFillsAll);
      const matchedTradeFills = rawFillsAll.filter(
        (f: any) => !f.algo_id,
      );
      const filteredSnapshots = snapshotsData ?? [];
      const closedTrades = (liveTradesData ?? []) as any[];

      // Map trades from live_trades table
      const mappedTrades = closedTrades.map((trade: any) =>
        mapLiveTradeToBacktestTrade(trade, workflowId, matchedTradeFills),
      );
      setTrades(mappedTrades);

      // Map snapshots
      if (filteredSnapshots.length > 0) {
        const mapped: PortfolioSnapshot[] = filteredSnapshots
          .filter((snapshot: any) => snapshot.snapshot_at)
          .map((snapshot: any, index: number, snaps: any[]) => {
            const mappedSnapshot = mapSnapshotToPortfolioSnapshot(
              snapshot,
              workflowId,
            );
            if (index > 0) {
              const prev = mapSnapshotToPortfolioSnapshot(
                snaps[index - 1],
                workflowId,
              );
              mappedSnapshot.daily_return =
                prev.total_value > 0
                  ? (mappedSnapshot.total_value - prev.total_value) /
                    prev.total_value
                  : undefined;
            }
            return mappedSnapshot;
          });
        setSnapshots(mapped);
      } else {
        setSnapshots([]);
      }

      // Compute metrics from closed trades + snapshots
      const tradeMetricInput = closedTrades.map((t: any) => ({
        netPnl: t.net_pnl != null ? Number(t.net_pnl) : undefined,
      }));

      setMetrics(
        buildLiveMetrics(
          undefined,
          tradeMetricInput,
          filteredSnapshots as any[],
        ) as BacktestResultMetrics,
      );
    } catch (err: any) {
      console.error("Error loading live strategy detail", err);
      setError(err.message || "Failed to load live strategy");
    } finally {
      setLoading(false);
    }
  }, [enabled, user, workflowId]);

  useEffect(() => {
    if (!enabled) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setRawFills([]);
      setSnapshots([]);
      activeSessionRunIdRef.current = null;
      pendingSessionRunIdRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    loadData();
  }, [enabled, loadData]);

  // Realtime: workflow_runs, live_trades, cash_snapshots
  useEffect(() => {
    if (!enabled || !user || !workflowId) return;

    const channel = supabase
      .channel(`live-detail-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_runs",
          filter: `workflow_id.eq.${workflowId}`,
        },
        () => {
          void loadData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_trades",
        },
        (payload) => {
          const newTrade = payload.new as any;
          if (newTrade.user_id !== user.id || newTrade.workflow_id !== workflowId)
            return;
          if (newTrade.execution_id !== activeSessionRunIdRef.current)
            return;

          // Reload to get full data with matched fills
          void loadData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cash_snapshots",
          filter: `and(user_id.eq.${user.id},workflow_id.eq.${workflowId})`,
        },
        (payload) => {
          const newSnapshot = payload.new as any;
          if (
            newSnapshot.user_id !== user.id ||
            newSnapshot.workflow_id !== workflowId
          )
            return;
          if (newSnapshot.execution_id !== activeSessionRunIdRef.current)
            return;

          setSnapshots((prev) => {
            const nextSnapshot = mapSnapshotToPortfolioSnapshot(
              newSnapshot,
              workflowId,
            );
            const previous = prev[prev.length - 1];
            if (previous && previous.total_value > 0) {
              nextSnapshot.daily_return =
                (nextSnapshot.total_value - previous.total_value) /
                previous.total_value;
            }
            return [...prev, nextSnapshot];
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [enabled, loadData, user, workflowId]);

  // Realtime: listen to workflows table for active_execution_id / is_active changes
  useEffect(() => {
    if (!enabled || !user || !workflowId) return;

    const channel = supabase
      .channel(`live-workflow-session-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "workflows",
          filter: `id.eq.${workflowId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          const newSessionId: string | null = updated.active_execution_id ?? null;
          const currentSessionId = activeSessionRunIdRef.current;

          // If session changed, reset immediately and refetch
          if (newSessionId !== currentSessionId) {
            activeSessionRunIdRef.current = newSessionId;
            pendingSessionRunIdRef.current = null;
            if (newSessionId) {
              localStorage.setItem(`live_session_${workflowId}`, newSessionId);
            }
            setTrades([]);
            setRawFills([]);
            setSnapshots([]);
            setMetrics(
              buildLiveMetrics(undefined, [], []) as BacktestResultMetrics,
            );
            void loadData();
          }
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [enabled, user, workflowId, loadData]);

  useEffect(() => {
    if (!enabled || !workflowId) return;

    const handleSessionUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{
        workflowId: string;
        sessionId: string | null;
      }>;

      if (customEvent.detail?.workflowId !== workflowId) return;

      pendingSessionRunIdRef.current = customEvent.detail.sessionId;
      activeSessionRunIdRef.current = customEvent.detail.sessionId;
      setTrades([]);
      setRawFills([]);
      setSnapshots([]);
      setMetrics(buildLiveMetrics(undefined, [], []) as BacktestResultMetrics);
      void loadData();
    };

    window.addEventListener("coreza-live-session-updated", handleSessionUpdate);
    return () => {
      window.removeEventListener(
        "coreza-live-session-updated",
        handleSessionUpdate,
      );
    };
  }, [enabled, workflowId, loadData]);

  return {
    backtest,
    metrics,
    trades,
    rawFills,
    snapshots,
    loading,
    error,
    refetch: loadData,
  };
};
