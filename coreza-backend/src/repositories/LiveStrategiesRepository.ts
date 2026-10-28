import { supabase } from "../config/supabase";
import { buildLiveMetrics, liveTradeMetricInput, normalizeLiveEquitySnapshots, LiveTradeAggregate } from "../reporting/liveMetrics";
import { finiteMetrics, reportingPages } from "../reporting/persistence";

const db = supabase as any;

export class LiveStrategiesRepository {
  private static dirty = new Set<string>();
  private static refreshes = new Map<string, Promise<void>>();

  static markDirty(id: string): void { this.dirty.add(id); }

  static async claim(userId: string, workflowId: string, executionId: string): Promise<void> {
    const { error } = await db.rpc("claim_reporting_activation", {
      p_user_id: userId, p_workflow_id: workflowId, p_execution_id: executionId,
    });
    if (error) throw new Error(error.message);
  }

  static async status(id: string): Promise<string | null> {
    const { data, error } = await db.from("live_strategies").select("status").eq("id", id).eq("mode", "live").maybeSingle();
    if (error) throw error;
    return data?.status ?? null;
  }

  static async completeStart(userId: string, workflowId: string, executionId: string, cron: string | null): Promise<any> {
    const { data, error } = await db.rpc("complete_reporting_activation", {
      p_user_id: userId, p_workflow_id: workflowId, p_execution_id: executionId, p_schedule_cron: cron,
    });
    if (error) throw new Error(error.message);
    this.markDirty(executionId);
    return data;
  }

  static async setStatus(id: string, userId: string, workflowId: string, status: "running" | "completed" | "cancelled" | "failed", errorMessage?: string): Promise<void> {
    const { data, error } = await db.from("live_strategies").update({
      status, updated_at: new Date().toISOString(),
      ...(status !== "running" ? { completed_at: new Date().toISOString() } : {}),
      ...(errorMessage ? { error_message: errorMessage } : {}),
    }).eq("id", id).eq("user_id", userId).eq("workflow_id", workflowId).eq("mode", "live")
      .in("status", status === "running" ? ["pending"] : ["pending", "running"]).select("id").maybeSingle();
    if (error) throw error;
    if (data) this.markDirty(id);
  }

  static async recoverPending(): Promise<void> {
    const rows = await reportingPages(() => db.from("live_strategies").select("id")
      .eq("mode", "live").or("metrics_updated_at.is.null,metrics_context->>finalization_pending.eq.true").order("id"));
    rows.forEach(row => this.markDirty(row.id));
  }

  static async refreshDirty(): Promise<void> {
    for (const id of [...this.dirty]) {
      this.dirty.delete(id);
      try { await this.refresh(id); }
      catch (error) { this.dirty.add(id); throw error; }
    }
  }

  static async refresh(id: string, full = false): Promise<void> {
    // Serialize per activation so an older refresh cannot overwrite final metrics.
    const previous = this.refreshes.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.refreshMetrics(id, full));
    this.refreshes.set(id, current);
    try { await current; }
    finally { if (this.refreshes.get(id) === current) this.refreshes.delete(id); }
  }

  private static async refreshMetrics(id: string, full: boolean): Promise<void> {
    const { data: header, error } = await db.from("live_strategies").select("*").eq("id", id).eq("mode", "live").single();
    if (error) throw error;
    full ||= !["pending", "running"].includes(header.status);
    const base = () => db.from("portfolio").select("*").eq("live_strategy_id", id);
    const { data: first, error: firstError } = await base().order("snapshot_at").order("id").limit(1).maybeSingle();
    if (firstError) throw firstError;
    let snapshots: any[] = [];
    if (first) {
      const series = () => base().eq("broker", first.broker).eq("credential_id", first.credential_id)
        [first.base_currency == null ? "is" : "eq"]("base_currency", first.base_currency);
      if (full) snapshots = await reportingPages(() => series().order("snapshot_at").order("id"));
      else {
        const { data: last, error: lastError } = await series().order("snapshot_at", { ascending: false }).order("id", { ascending: false }).limit(1).single();
        if (lastError) throw lastError;
        snapshots = first.id === last.id ? [first] : [first, last];
      }
    }
    let trades: any[] = [];
    let aggregate: LiveTradeAggregate | undefined;
    if (full) trades = await reportingPages(() => db.from("trades").select("*").eq("live_strategy_id", id).order("exitTime").order("id"));
    else {
      const { data, error: aggregateError } = await db.rpc("reporting_trade_aggregate", { p_live_strategy_id: id });
      if (aggregateError) throw aggregateError;
      aggregate = data;
    }
    const summary = header.initial_capital == null ? undefined : { initial_capital: Number(header.initial_capital) };
    const metrics = finiteMetrics(buildLiveMetrics(summary, trades.map(liveTradeMetricInput), snapshots, aggregate));
    // Compact refreshes must not estimate risk from only the first/last samples.
    if (!full) for (const key of ["max_drawdown", "annualized_return", "sharpe_ratio", "sortino_ratio", "calmar_ratio"]) delete metrics[key];
    const normalization = normalizeLiveEquitySnapshots(snapshots, summary);
    const { data: updated, error: updateError } = await db.from("live_strategies").update({
      ...metrics, base_currency: first?.base_currency ?? header.base_currency,
      metrics_updated_at: new Date().toISOString(),
      metrics_context: { ...header.metrics_context,
        ...(full ? { finalization_pending: false } : {}),
        initial_capital: header.initial_capital != null ? "recorded" : normalization.initialCapital == null ? "unavailable" : "inferred",
        ...(first ? { snapshot_source: { broker: first.broker, credential_id: first.credential_id, base_currency: first.base_currency } } : {}),
      },
    }).eq("id", id).eq("mode", "live").eq("status", header.status).select("id").maybeSingle();
    if (!updated && !updateError) { this.markDirty(id); return; }
    if (updateError) throw updateError;
  }
}
