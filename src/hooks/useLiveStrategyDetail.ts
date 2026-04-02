import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BacktestWithRelations,
  BacktestResultMetrics,
  BacktestTrade,
  PortfolioSnapshot,
} from "./useBacktestResults";

const getNodeMode = (node: any) =>
  node?.values?.mode ??
  node?.data?.values?.mode ??
  node?.data?.config?.mode ??
  node?.data?.mode;

const isPortfolioNode = (node: any) => {
  const nodeName =
    `${node?.type ?? node?.name ?? node?.def ?? node?.node_type ?? ""}`.toLowerCase();
  return nodeName === "portfolio";
};

const extractCredentialIds = (nodes: unknown): string[] => {
  if (!Array.isArray(nodes)) return [];

  const credentialIds = new Set<string>();

  for (const node of nodes) {
    const values =
      node?.values ?? node?.data?.values ?? node?.data?.config ?? {};
    const credentialId =
      values?.credential_id ?? node?.data?.credential_id ?? node?.credential_id;

    if (typeof credentialId === "string" && credentialId.length > 0) {
      credentialIds.add(credentialId);
    }

    if (isPortfolioNode(node) && getNodeMode(node) === "broker") {
      const portfolioCredentialId =
        values?.credential_id ??
        node?.data?.credential_id ??
        node?.credential_id;

      if (
        typeof portfolioCredentialId === "string" &&
        portfolioCredentialId.length > 0
      ) {
        credentialIds.add(portfolioCredentialId);
      }
    }
  }

  return Array.from(credentialIds);
};

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

const mapSnapshotToPortfolioSnapshot = (
  snapshot: any,
  workflowId: string,
): PortfolioSnapshot => ({
  id: snapshot.id,
  backtest_id: workflowId,
  date: snapshot.snapshot_at,
  cash_balance: snapshot.total_value_usdt ?? 0,
  stock_value: 0,
  total_value: snapshot.total_value_usdt ?? 0,
  daily_return: undefined,
});

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const credentialFilter = useMemo(
    () => new Set(credentialIds),
    [credentialIds],
  );

  const loadData = useCallback(async () => {
    if (!enabled || !user || !workflowId) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setSnapshots([]);
      setCredentialIds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, updated_at, nodes")
        .eq("user_id", user.id)
        .eq("id", workflowId)
        .single();

      if (wfErr) throw wfErr;

      const scopedCredentialIds = extractCredentialIds(wf.nodes);
      const scopedCredentialSet = new Set(scopedCredentialIds);
      setCredentialIds(scopedCredentialIds);

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

      if (fillsResult.status === "fulfilled" && fillsResult.value.data) {
        const mapped: BacktestTrade[] = fillsResult.value.data
          .filter(
            (fill: any) =>
              scopedCredentialSet.size === 0 ||
              scopedCredentialSet.has(fill.credential_id),
          )
          .map((fill: any) => mapFillToTrade(fill, workflowId));
        setTrades(mapped);
      }

      if (
        snapshotsResult.status === "fulfilled" &&
        snapshotsResult.value.data
      ) {
        const mapped: PortfolioSnapshot[] = snapshotsResult.value.data
          .filter(
            (snapshot: any) =>
              scopedCredentialSet.size === 0 ||
              scopedCredentialSet.has(snapshot.credential_id),
          )
          .map((snapshot: any) =>
            mapSnapshotToPortfolioSnapshot(snapshot, workflowId),
          );
        setSnapshots(mapped);
      }

      if (runsResult.status === "fulfilled" && runsResult.value.data?.result) {
        const result = runsResult.value.data.result as any;
        const nodeResults = result?.nodeResults || {};
        const portfolioNode = Object.values(nodeResults).find(
          (nr: any) => nr?.data?.total_equity !== undefined,
        ) as any;

        if (portfolioNode?.data) {
          const p = portfolioNode.data;
          setMetrics({
            total_return: toNumberOrUndefined(p.total_return),
            net_profit: toNumberOrUndefined(p.realized_pnl),
            total_trades: toNumberOrUndefined(p.trades_count),
            final_portfolio_value: toNumberOrUndefined(p.total_equity),
            win_rate: undefined,
            sharpe_ratio: undefined,
          } as BacktestResultMetrics);
        }
      }
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
      setCredentialIds([]);
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
          event: "INSERT",
          schema: "public",
          table: "live_fills",
          filter: `and(user_id.eq.${user.id},workflow_id.eq.${workflowId})`,
        },
        (payload) => {
          const newFill = payload.new as any;
          if (newFill.user_id !== user.id || newFill.workflow_id !== workflowId)
            return;
          if (
            credentialFilter.size > 0 &&
            !credentialFilter.has(newFill.credential_id)
          )
            return;

          setTrades((prev) => [...prev, mapFillToTrade(newFill, workflowId)]);
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
            credentialFilter.size > 0 &&
            !credentialFilter.has(newSnapshot.credential_id)
          )
            return;

          setSnapshots((prev) => [
            ...prev,
            mapSnapshotToPortfolioSnapshot(newSnapshot, workflowId),
          ]);
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [credentialFilter, enabled, user, workflowId]);

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
