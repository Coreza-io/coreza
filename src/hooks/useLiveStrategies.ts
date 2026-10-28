import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Backtest } from "./useBacktests";
import { reportingPages } from "@/lib/reportingPages";
import { useScopedLoader } from "./useScopedLoader";

/** One row per activation, including runs without a trade or snapshot. */
export const useLiveStrategies = (enabled = true) => {
  const { user } = useAuth();
  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const performLoad = useCallback(async (isCurrent: () => boolean) => {
    if (!enabled || !user) return;
    setLoading(true); setError(null);
    try {
      const rows = await reportingPages(() => supabase.from("live_strategies").select("*")
        .eq("user_id", user.id).eq("mode", "live")
        .order("started_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }));
      if (!isCurrent()) return;
      setBacktests(rows.map(row => ({
        id: row.id, execution_id: row.execution_id, name: row.name,
        workflow_id: row.workflow_id, workflow_name: row.name,
        status: row.status,
        total_return: row.total_return, sharpe_ratio: row.sharpe_ratio,
        total_trades: row.total_trades, created_at: row.started_at, completed_at: row.completed_at,
      })));
    } catch (err: any) {
      if (isCurrent()) setError(err.message || "Failed to load live strategies");
    } finally { if (isCurrent()) setLoading(false); }
  }, [enabled, user?.id]);
  const load = useScopedLoader(`${user?.id ?? ""}:${enabled}`, performLoad);
  useEffect(() => {
    setBacktests([]); setError(null); setLoading(false);
    if (enabled && user) void load();
  }, [enabled, user?.id, load]);
  useEffect(() => {
    if (!enabled || !user) return;
    const channel = supabase.channel(`live-strategies-${user.id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "live_strategies", filter: `user_id=eq.${user.id}`,
    }, () => { void load(); }).subscribe();
    return () => { void channel.unsubscribe(); };
  }, [enabled, user?.id, load]);
  const stats = useMemo(() => backtests.reduce((acc, row) => {
    acc.total++; acc[row.status]++; return acc;
  }, { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }), [backtests]);
  return { backtests, loading, error, stats, refetch: load };
};
