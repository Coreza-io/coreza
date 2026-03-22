import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BacktestWithRelations,
  BacktestResultMetrics,
  BacktestTrade,
  PortfolioSnapshot,
} from "./useBacktestResults";

/**
 * Returns live strategy detail data shaped identically to useBacktestResults
 * for seamless UI reuse (EquityCurveChart, TradesTable, PerformanceMetricsCard).
 */
export const useLiveStrategyDetail = (workflowId?: string) => {
  const { user } = useAuth();
  const [backtest, setBacktest] = useState<BacktestWithRelations | null>(null);
  const [metrics, setMetrics] = useState<BacktestResultMetrics | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !workflowId) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Workflow metadata
      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, updated_at, nodes")
        .eq("user_id", user.id)
        .eq("id", workflowId)
        .single();

      if (wfErr) throw wfErr;

      // Map to BacktestWithRelations shape
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

      // 2. Fetch live_fills, cash_snapshots, latest run in parallel
      const [fillsResult, snapshotsResult, runsResult] =
        await Promise.allSettled([
          supabase
            .from("live_fills")
            .select("*")
            .eq("user_id", user.id)
            .order("event_time", { ascending: true }),
          supabase
            .from("cash_snapshots")
            .select("*")
            .eq("user_id", user.id)
            .order("snapshot_at", { ascending: true }),
          supabase
            .from("workflow_runs")
            .select("result")
            .eq("workflow_id", workflowId)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      // 3. Map live_fills → BacktestTrade[]
      if (fillsResult.status === "fulfilled" && fillsResult.value.data) {
        const mapped: BacktestTrade[] = fillsResult.value.data.map(
          (fill: any) => ({
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
          })
        );
        setTrades(mapped);
      }

      // 4. Map cash_snapshots → PortfolioSnapshot[]
      if (
        snapshotsResult.status === "fulfilled" &&
        snapshotsResult.value.data
      ) {
        const mapped: PortfolioSnapshot[] = snapshotsResult.value.data.map(
          (snap: any) => ({
            id: snap.id,
            backtest_id: workflowId,
            date: snap.snapshot_at,
            cash_balance: snap.total_value_usdt ?? 0,
            stock_value: 0,
            total_value: snap.total_value_usdt ?? 0,
            daily_return: undefined,
          })
        );
        setSnapshots(mapped);
      }

      // 5. Extract metrics from latest run result
      if (runsResult.status === "fulfilled" && runsResult.value.data?.result) {
        const result = runsResult.value.data.result as any;
        const nodeResults = result?.nodeResults || {};
        const portfolioNode = Object.values(nodeResults).find(
          (nr: any) => nr?.data?.equity !== undefined
        ) as any;

        if (portfolioNode?.data) {
          const p = portfolioNode.data;
          setMetrics({
            total_return: p.totalReturnPct,
            net_profit: p.realizedPnl,
            total_trades: p.tradeCount,
            final_portfolio_value: p.equity,
            win_rate: p.winRate,
            sharpe_ratio: p.sharpeRatio,
          } as BacktestResultMetrics);
        }
      }
    } catch (err: any) {
      console.error("Error loading live strategy detail", err);
      setError(err.message || "Failed to load live strategy");
    } finally {
      setLoading(false);
    }
  }, [workflowId, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime on live_fills and cash_snapshots
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`live-detail-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_fills",
          filter: `user_id=eq.${user.id}`,
        },
        () => loadData()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cash_snapshots",
          filter: `user_id=eq.${user.id}`,
        },
        () => loadData()
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [loadData, user, workflowId]);

  return { backtest, metrics, trades, snapshots, loading, error, refetch: loadData };
};
