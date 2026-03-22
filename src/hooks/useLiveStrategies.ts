import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Backtest, BacktestStatus } from "./useBacktests";

/**
 * Returns live (active) workflows with portfolio broker nodes,
 * shaped identically to useBacktests for UI reuse.
 */
export const useLiveStrategies = () => {
  const { user } = useAuth();
  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch active workflows
      const { data: workflows, error: wfError } = await supabase
        .from("workflows")
        .select("id, name, is_active, created_at, nodes")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (wfError) throw wfError;

      // Filter: only workflows containing a Portfolio node with mode "broker"
      const liveWorkflows = (workflows || []).filter((wf: any) => {
        const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
        return nodes.some(
          (n: any) =>
            n.type === "portfolio" &&
            n.data?.config?.mode === "broker"
        );
      });

      if (liveWorkflows.length === 0) {
        setBacktests([]);
        return;
      }

      // Fetch latest workflow_runs for each workflow to get metrics
      const workflowIds = liveWorkflows.map((w: any) => w.id);
      const { data: runs } = await supabase
        .from("workflow_runs")
        .select("workflow_id, result, status, started_at")
        .in("workflow_id", workflowIds)
        .order("started_at", { ascending: false });

      // Group: latest run per workflow
      const latestRunByWorkflow: Record<string, any> = {};
      for (const run of runs || []) {
        if (!latestRunByWorkflow[run.workflow_id]) {
          latestRunByWorkflow[run.workflow_id] = run;
        }
      }

      // Fetch trade counts from live_fills
      const { data: fillCounts } = await supabase
        .from("live_fills")
        .select("id, credential_id")
        .eq("user_id", user.id);

      // Count fills per user (simple total for now)
      const totalFills = fillCounts?.length ?? 0;

      const mapped: Backtest[] = liveWorkflows.map((wf: any) => {
        const run = latestRunByWorkflow[wf.id];
        const result = run?.result as any;

        // Extract metrics from the latest run result if available
        const portfolioResult = result?.nodeResults
          ? Object.values(result.nodeResults).find(
              (nr: any) => nr?.data?.equity !== undefined
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
  }, [user]);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  // Realtime subscription on workflows changes
  useEffect(() => {
    if (!user) return;
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
        () => loadStrategies()
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [loadStrategies, user]);

  const stats = useMemo(() => {
    return backtests.reduce(
      (acc, b) => {
        acc.total += 1;
        acc[b.status] += 1;
        return acc;
      },
      { total: 0, pending: 0, running: 0, completed: 0, failed: 0 }
    );
  }, [backtests]);

  return { backtests, loading, error, stats, refetch: loadStrategies };
};
