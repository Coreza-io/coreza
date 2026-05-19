import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Backtest, BacktestStatus } from "./useBacktests";
import { isBrokerPortfolioWorkflow } from "@/utils/liveWorkflowFilter";

/**
 * Returns live (active) workflows with portfolio broker nodes,
 * shaped identically to useBacktests for UI reuse.
 */
export const useLiveStrategies = (enabled = true) => {
  const { user } = useAuth();
  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategies = useCallback(async () => {
    if (!enabled || !user) {
      setBacktests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: workflows, error: wfError } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, nodes")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (wfError) throw wfError;

      const liveWorkflows = (workflows || []).filter(isBrokerPortfolioWorkflow);

      if (liveWorkflows.length === 0) {
        setBacktests([]);
        return;
      }

      const latestRuns = await Promise.allSettled(
        liveWorkflows.map(async (workflow: any) => {
          const { data, error: runError } = await supabase
            .from("workflow_runs")
            .select("workflow_id, result, status, started_at")
            .eq("workflow_id", workflow.id)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (runError) throw runError;
          return data;
        }),
      );

      const latestRunByWorkflow: Record<string, any> = {};
      for (const runResult of latestRuns) {
        if (runResult.status === "fulfilled" && runResult.value?.workflow_id) {
          latestRunByWorkflow[runResult.value.workflow_id] = runResult.value;
        }
      }

      const mapped: Backtest[] = liveWorkflows.map((wf: any) => {
        const run = latestRunByWorkflow[wf.id];
        const result = run?.result as any;
        const portfolioResult = result?.nodeResults
          ? Object.values(result.nodeResults).find(
              (nr: any) => nr?.data?.equity !== undefined,
            )
          : null;

        const portfolio = (portfolioResult as any)?.data;

        let status: BacktestStatus = "running";
        if (!wf.is_active) status = "completed";

        return {
          id: wf.id,
          name: wf.name,
          workflow_id: wf.id,
          workflow_name: wf.name,
          status,
          total_return: portfolio?.totalReturnPct ?? undefined,
          sharpe_ratio: undefined,
          total_trades: portfolio?.tradeCount ?? undefined,
          created_at: wf.created_at,
        };
      });

      setBacktests(mapped);
    } catch (err: any) {
      console.error("Error loading live strategies", err);
      setError(err.message || "Failed to load live strategies");
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

    loadStrategies();
  }, [enabled, loadStrategies]);

  useEffect(() => {
    if (!enabled || !user) return;

    const channel = supabase
      .channel("live-strategies")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflows",
          filter: `user_id=eq.${user.id}`,
        },
        () => loadStrategies(),
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [enabled, loadStrategies, user]);

  const stats = useMemo(() => {
    return backtests.reduce(
      (acc, b) => {
        acc.total += 1;
        acc[b.status] += 1;
        return acc;
      },
      { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
    );
  }, [backtests]);

  return { backtests, loading, error, stats, refetch: loadStrategies };
};
