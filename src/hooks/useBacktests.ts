import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type BacktestStatus = "pending" | "running" | "completed" | "failed";

const BACKTEST_STATUSES: BacktestStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
];

const toBacktestStatus = (value: unknown): BacktestStatus => {
  return BACKTEST_STATUSES.includes(value as BacktestStatus)
    ? (value as BacktestStatus)
    : "pending";
};

export interface Backtest {
  id: string;
  name: string;
  workflow_id: string;
  workflow_name?: string;
  status: BacktestStatus;
  total_return?: number;
  sharpe_ratio?: number;
  total_trades?: number;
  created_at?: string;
}

export const useBacktests = (enabled = true) => {
  const { user } = useAuth();
  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBacktests = useCallback(async () => {
    if (!enabled || !user) {
      setBacktests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: supabaseError } = await supabase
        .from("backtests")
        .select(
          `
          id,
          name,
          workflow_id,
          status,
          created_at,
          workflows(name),
          backtest_results(total_return, sharpe_ratio, total_trades)
        `,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (supabaseError) throw supabaseError;

      const parsed = (data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        workflow_id: item.workflow_id,
        workflow_name: item.workflows?.name,
        status: toBacktestStatus(item.status),
        total_return: item.backtest_results?.[0]?.total_return,
        sharpe_ratio: item.backtest_results?.[0]?.sharpe_ratio,
        total_trades: item.backtest_results?.[0]?.total_trades,
        created_at: item.created_at,
      }));

      setBacktests(parsed);
    } catch (err: any) {
      console.error("Error loading backtests", err);
      setError(err.message || "Failed to load backtests");
    } finally {
      setLoading(false);
    }
  }, [enabled, user]);

  useEffect(() => {
    if (!enabled) {
      setBacktests([]);
      setLoading(false);
      setError(null);
      return;
    }

    loadBacktests();
  }, [enabled, loadBacktests, user]);

  useEffect(() => {
    if (!enabled || !user) return;

    const channel = supabase
      .channel("backtests-status")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "backtests",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadBacktests();
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [enabled, loadBacktests, user]);

  const stats = useMemo(() => {
    return backtests.reduce(
      (acc, backtest) => {
        acc.total += 1;
        const status = toBacktestStatus(backtest.status);
        acc[status] += 1;
        return acc;
      },
      { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
    );
  }, [backtests]);

  return {
    backtests,
    loading,
    error,
    stats,
    refetch: loadBacktests,
  };
};
