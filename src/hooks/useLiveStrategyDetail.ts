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

const mapFillToTrade = (fill: any, workflowId: string): BacktestTrade => ({
  id: fill.id,
  backtest_id: workflowId,
  symbol: fill.symbol,
  action: fill.side,
  quantity: fill.qty,
  entryPrice: null,
  entryTime: null,
  exitPrice: fill.price,
  exitTime: fill.event_time,
  commission: fill.commission,
  slippage: null,
  net_pnl: fill.quote_qty ?? null,
});

const mapClosedTradeToBacktestTrade = (
  trade: any,
  workflowId: string,
): BacktestTrade => ({
  id: trade.id,
  backtest_id: workflowId,
  symbol: trade.symbol,
  action: trade.side,
  quantity: trade.quantity ?? 0,
  entryPrice: trade.entryPrice ?? null,
  entryTime: trade.entryTime ?? null,
  exitPrice: trade.exitPrice ?? null,
  exitTime: trade.exitTime ?? null,
  commission: trade.commission ?? null,
  slippage: trade.slippage ?? null,
  net_pnl: trade.netPnl ?? null,
});

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
  const [portfolioSummary, setPortfolioSummary] = useState<any | null>(null);
  const closedTradesRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!enabled || !user || !workflowId) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setSnapshots([]);
      setPortfolioSummary(null);
      closedTradesRef.current = [];
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

      const [fillsResult, snapshotsResult, runsResult] =
        await Promise.allSettled([
          supabase
            .from("live_fills")
            .select("*")
            .eq("user_id", user.id)
            .eq("workflow_id", workflowId)
            .order("event_time", { ascending: true }),
          supabase
            .from("cash_snapshots")
            .select("*")
            .eq("user_id", user.id)
            .eq("workflow_id", workflowId)
            .order("snapshot_at", { ascending: true }),
          supabase
            .from("workflow_runs")
            .select("result")
            .eq("workflow_id", workflowId)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      let fillMappedTrades: BacktestTrade[] = [];
      if (fillsResult.status === "fulfilled" && fillsResult.value.data) {
        fillMappedTrades = fillsResult.value.data
          .map((fill: any) => mapFillToTrade(fill, workflowId));
      }

      const filteredSnapshots =
        snapshotsResult.status === "fulfilled" && snapshotsResult.value.data
          ? snapshotsResult.value.data
          : [];

      if (filteredSnapshots.length > 0) {
        const mapped: PortfolioSnapshot[] = filteredSnapshots
          .filter(
            (snapshot: any) => snapshot.snapshot_at,
          )
          .map((snapshot: any, index: number, snapshots: any[]) => {
            const mappedSnapshot = mapSnapshotToPortfolioSnapshot(
              snapshot,
              workflowId,
            );
            if (index > 0) {
              const prev = mapSnapshotToPortfolioSnapshot(
                snapshots[index - 1],
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

      let latestPortfolioSummary: any | null = null;
      let latestClosedTrades: any[] = [];
      if (runsResult.status === "fulfilled" && runsResult.value.data?.result) {
        const result = runsResult.value.data.result as any;
        const nodeResults = result?.nodeResults || {};
        const portfolioNode = Object.values(nodeResults).find(
          (nr: any) => nr?.data?.total_equity !== undefined,
        ) as any;

        if (portfolioNode?.data) {
          latestPortfolioSummary = portfolioNode.data;
          latestClosedTrades = Array.isArray(portfolioNode.data.trades)
            ? portfolioNode.data.trades
            : [];
        }
      }

      setPortfolioSummary(latestPortfolioSummary);
      closedTradesRef.current = latestClosedTrades;
      if (latestClosedTrades.length > 0) {
        setTrades(
          latestClosedTrades.map((trade) =>
            mapClosedTradeToBacktestTrade(trade, workflowId),
          ),
        );
      } else {
        setTrades(fillMappedTrades);
      }
      setMetrics(
        buildLiveMetrics(
          latestPortfolioSummary ?? undefined,
          latestClosedTrades,
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
      setPortfolioSummary(null);
      closedTradesRef.current = [];
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
          table: "live_fills",
          filter: `and(user_id.eq.${user.id},workflow_id.eq.${workflowId})`,
        },
        (payload) => {
          const newFill = payload.new as any;
          if (newFill.user_id !== user.id || newFill.workflow_id !== workflowId)
            return;

          if (closedTradesRef.current.length === 0) {
            setTrades((prev) => [...prev, mapFillToTrade(newFill, workflowId)]);
          }
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
            const nextSnapshots = [...prev, nextSnapshot];
            setMetrics(
              buildLiveMetrics(
                portfolioSummary ?? undefined,
                closedTradesRef.current,
                nextSnapshots.map((snapshot) => ({
                  id: snapshot.id,
                  snapshot_at: snapshot.date,
                  cash: snapshot.cash_balance,
                  equity: snapshot.total_value,
                })),
              ) as BacktestResultMetrics,
            );
            return nextSnapshots;
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [
    enabled,
    loadData,
    portfolioSummary,
    user,
    workflowId,
  ]);

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
