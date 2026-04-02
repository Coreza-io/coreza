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
      (f: any) => f.order_id === entryOrderId || f.order_id === exitOrderId,
    );
    if (matchedFills.length > 0) {
      orders = matchedFills.map((f: any) => ({
        id: f.id,
        symbol: f.symbol,
        side: f.side,
        orderType: "Market",
        fillPrice: f.price,
        quantity: f.qty,
        status: "Filled",
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
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const activeSessionRunIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!enabled || !user || !workflowId) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setSnapshots([]);
      activeSessionRunIdRef.current = null;
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, updated_at")
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

      // Get latest run for session scoping
      const { data: latestRun, error: latestRunErr } = await supabase
        .from("workflow_runs")
        .select("id, status, started_at")
        .eq("workflow_id", workflowId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRunErr) throw latestRunErr;

      const latestRunStartedAt = latestRun?.started_at ?? null;

      // Find the active session run_id
      let latestSnapshotSessionQuery = supabase
        .from("cash_snapshots")
        .select("run_id")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId)
        .not("run_id", "is", null)
        .order("snapshot_at", { ascending: false })
        .limit(1);
      if (latestRunStartedAt) {
        latestSnapshotSessionQuery = latestSnapshotSessionQuery.gte(
          "snapshot_at",
          latestRunStartedAt,
        );
      }
      const { data: latestSnapshotSession, error: latestSnapshotSessionErr } =
        await latestSnapshotSessionQuery.maybeSingle();

      if (latestSnapshotSessionErr) throw latestSnapshotSessionErr;

      let sessionRunId = latestSnapshotSession?.run_id ?? null;
      if (!sessionRunId) {
        let latestFillSessionQuery = supabase
          .from("live_fills")
          .select("run_id")
          .eq("user_id", user.id)
          .eq("workflow_id", workflowId)
          .not("run_id", "is", null)
          .order("event_time", { ascending: false })
          .limit(1);
        if (latestRunStartedAt) {
          latestFillSessionQuery = latestFillSessionQuery.gte(
            "event_time",
            latestRunStartedAt,
          );
        }
        const { data: latestFillSession, error: latestFillSessionErr } =
          await latestFillSessionQuery.maybeSingle();

        if (latestFillSessionErr) throw latestFillSessionErr;
        sessionRunId = latestFillSession?.run_id ?? null;
      }

      activeSessionRunIdRef.current = sessionRunId;

      // Fetch live_trades, live_fills, and cash_snapshots in parallel
      const tradesQuery = supabase
        .from("live_trades" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId);
      if (sessionRunId) {
        tradesQuery.eq("run_id", sessionRunId);
      }
      tradesQuery.order("exitTime" as any, { ascending: true });

      const fillsQuery = supabase
        .from("live_fills")
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId);
      if (sessionRunId) {
        fillsQuery.eq("run_id", sessionRunId);
      }
      fillsQuery.order("event_time", { ascending: true });

      const snapshotsQuery = supabase
        .from("cash_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId);
      if (sessionRunId) {
        snapshotsQuery.eq("run_id", sessionRunId);
      }
      snapshotsQuery.order("snapshot_at", { ascending: true });

      const [
        { data: liveTradesData, error: liveTradesErr },
        { data: fillsData, error: fillsErr },
        { data: snapshotsData, error: snapshotsErr },
      ] = await Promise.all([tradesQuery, fillsQuery, snapshotsQuery]);

      if (liveTradesErr) throw liveTradesErr;
      if (fillsErr) throw fillsErr;
      if (snapshotsErr) throw snapshotsErr;

      const rawFills = fillsData ?? [];
      const filteredSnapshots = snapshotsData ?? [];
      const closedTrades = (liveTradesData ?? []) as any[];

      // Map trades from live_trades table
      const mappedTrades = closedTrades.map((trade: any) =>
        mapLiveTradeToBacktestTrade(trade, workflowId, rawFills),
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
          filteredSnapshots,
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
      setSnapshots([]);
      activeSessionRunIdRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    loadData();
  }, [enabled, loadData]);

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
          if (
            activeSessionRunIdRef.current &&
            newTrade.run_id !== activeSessionRunIdRef.current
          )
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
          if (
            activeSessionRunIdRef.current &&
            newSnapshot.run_id !== activeSessionRunIdRef.current
          )
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

  return {
    backtest,
    metrics,
    trades,
    snapshots,
    loading,
    error,
    refetch: loadData,
  };
};
