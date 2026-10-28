import { apiClient } from "@/lib/apiClient";
import { reportingPages } from "@/lib/reportingPages";
import { useScopedLoader } from "./useScopedLoader";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BacktestWithRelations,
  BacktestResultMetrics,
  BacktestTrade,
  PortfolioSnapshot,
} from "./useBacktestResults";
import { buildLiveMetrics, normalizeLiveEquitySnapshots, liveTradeMetricInput, selectLiveSnapshotSeries } from "@/lib/liveMetrics";

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

const mapNormalizedSnapshots = (raw: any[], workflowId: string, normalized: ReturnType<typeof normalizeLiveEquitySnapshots>): PortfolioSnapshot[] => {
  const equityByTimestamp = new Map(normalized.normalizedSnapshots.map(row => [row.ts, row.equity]));
  const rows = raw.filter(row => row.snapshot_at).map(row => {
    const snapshot = mapSnapshotToPortfolioSnapshot(row, workflowId);
    const equity = equityByTimestamp.get(Date.parse(row.snapshot_at));
    if (equity !== undefined) snapshot.total_value = equity;
    return snapshot;
  });
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    rows[index].daily_return = previous.total_value > 0 ? (rows[index].total_value - previous.total_value) / previous.total_value * 100 : undefined;
  }
  return rows;
};

/** Historical selection always wins; all children use the validated header ID. */
export const useLiveStrategyDetail = (workflowId?: string, enabled = true, executionId?: string | null) => {
  const { user, session } = useAuth();
  const [backtest, setBacktest] = useState<BacktestWithRelations | null>(null);
  const [metrics, setMetrics] = useState<BacktestResultMetrics | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [rawFills, setRawFills] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const performLoad = useCallback(async (isCurrent: () => boolean) => {
    if (!enabled || !user || !workflowId || !isCurrent()) return;
    setLoading(true); setError(null);
    try {
      const { data: workflow, error: workflowError } = await supabase.from("workflows")
        .select("id,active_execution_id").eq("id", workflowId).eq("user_id", user.id).single();
      if (workflowError) throw workflowError;
      const activation = executionId || workflow.active_execution_id;
      const query = supabase.from("live_strategies").select("*").eq("mode", "live")
        .eq("user_id", user.id).eq("workflow_id", workflowId);
      const { data: header, error: headerError } = await (activation ? query.eq("execution_id", activation) : query)
        .order("started_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(1).single();
      if (!isCurrent()) return;
      if (headerError) throw headerError;
      setSelectedId(header.id);
      const [closedTrades, fills, rawSnapshots] = await Promise.all([
        reportingPages(() => supabase.from("trades").select("*").eq("live_strategy_id", header.id).order("exitTime").order("id")),
        reportingPages(() => supabase.from("live_fills").select("*").eq("user_id", user.id).eq("workflow_id", workflowId).eq("execution_id", header.execution_id).order("event_time").order("id")),
        reportingPages(() => supabase.from("portfolio").select("*").eq("live_strategy_id", header.id).order("snapshot_at").order("id")),
      ]);
      if (!isCurrent()) return;
      const series = selectLiveSnapshotSeries(rawSnapshots);
      const summary = header.initial_capital == null ? undefined : { initial_capital: Number(header.initial_capital) };
      const normalized = normalizeLiveEquitySnapshots(series, summary);
      setBacktest({
        id: header.id, name: header.name, workflow_id: header.workflow_id,
        status: (header.metrics_context as any)?.lifecycle_unknown ? "unknown" : header.status as BacktestWithRelations["status"],
        started_at: header.started_at, completed_at: header.completed_at,
        start_date: header.started_at ?? "", end_date: header.completed_at ?? "",
        initial_capital: header.initial_capital ?? normalized.initialCapital,
        error_message: header.error_message,
      } as BacktestWithRelations);
      setRawFills(fills);
      setTrades(closedTrades.map(row => mapLiveTradeToBacktestTrade(row, workflowId, fills.filter(fill => !fill.algo_id))));
      setSnapshots(mapNormalizedSnapshots(series, workflowId, normalized));
      setMetrics({ ...buildLiveMetrics(summary, closedTrades.map(liveTradeMetricInput), series),
        metrics_context: { ...header.metrics_context,
          initial_capital: header.initial_capital != null ? "recorded" : normalized.initialCapital == null ? "unavailable" : "inferred",
        },
        base_currency: header.base_currency ?? series[0]?.base_currency,
        metrics_updated_at: header.metrics_updated_at,
      });
    } catch (err: any) {
      if (isCurrent()) { setError(err.message || "Failed to load live strategy"); setBacktest(null); }
    } finally { if (isCurrent()) setLoading(false); }
  }, [enabled, user?.id, workflowId, executionId]);
  const loadData = useScopedLoader(`${user?.id ?? ""}:${workflowId ?? ""}:${executionId ?? ""}:${enabled}`, performLoad);
  useEffect(() => {
    setSelectedId(null); setBacktest(null); setMetrics(null); setTrades([]); setSnapshots([]); setRawFills([]); setError(null); setLoading(false);
    if (enabled && user && workflowId) void loadData();
  }, [enabled, user?.id, workflowId, executionId, loadData]);
  useEffect(() => {
    if (!enabled || !user || !workflowId) return;
    const refresh = () => { void loadData(); };
    const channel = supabase.channel(`strategy-detail-${workflowId}-${selectedId ?? "current"}`);
    if (selectedId) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "live_strategies", filter: `id=eq.${selectedId}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: `live_strategy_id=eq.${selectedId}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "portfolio", filter: `live_strategy_id=eq.${selectedId}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "live_fills", filter: `execution_id=eq.${selectedId}` }, refresh);
    }
    if (!executionId) channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "workflows", filter: `id=eq.${workflowId}` }, refresh);
    channel.subscribe();
    const sessionUpdate = (event: Event) => {
      if (!executionId && (event as CustomEvent).detail?.workflowId === workflowId) refresh();
    };
    window.addEventListener("coreza-live-session-updated", sessionUpdate);
    return () => { void channel.unsubscribe(); window.removeEventListener("coreza-live-session-updated", sessionUpdate); };
  }, [enabled, user?.id, workflowId, executionId, selectedId, loadData]);
  const refetch = useCallback(async () => {
    if (!selectedId || !session?.access_token) return;
    setLoading(true); setError(null);
    try {
      const response = await apiClient.post(`/portfolio/reporting/${selectedId}/refresh`, {}, session.access_token);
      if (!response.ok) throw new Error("Failed to refresh reporting metrics");
      await loadData();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [selectedId, session?.access_token, loadData]);
  return { backtest, metrics, trades, rawFills, snapshots, loading, error, refetch };
};
