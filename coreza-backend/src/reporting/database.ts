import type { BacktestResultMetrics } from "./types";

type MetricColumns = { [K in Exclude<keyof BacktestResultMetrics, "metrics_context" | "base_currency" | "metrics_updated_at">]-?: number | null };
export type ReportingHeaderRow = MetricColumns & {
  id: string; backtest_id: string | null; execution_id: string | null;
  mode: "backtest" | "live"; user_id: string; workflow_id: string; name: string;
  source_workflow_revision: number | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  started_at: string | null; completed_at: string | null; updated_at: string; created_at: string;
  error_message: string | null; initial_capital: number | null; base_currency: string | null;
  metrics_updated_at: string | null; metrics_context: Record<string, unknown>;
};
export type ReportingTradeRow = {
  id: string; live_strategy_id: string; backtest_id: string | null;
  user_id: string; workflow_id: string; execution_id: string | null;
  symbol: string; action: string; quantity: number;
  entryPrice: number | null; exitPrice: number; entryTime: string | null; exitTime: string;
  commission: number | null; slippage: number | null; net_pnl: number | null; gross_pnl: number | null;
  entry_order_id: string | null; exit_order_id: string | null;
  holding_period_bars: number | null; exit_reason: string | null;
  return_pct: number | null; portfolio_value_before: number | null; portfolio_value_after: number | null;
  created_at: string;
};
export type ReportingPortfolioRow = {
  id: string; live_strategy_id: string; backtest_id: string | null;
  user_id: string; workflow_id: string; execution_id: string | null;
  date: string | null; total_value: number | null; cash_balance: number | null;
  stock_value: number | null; daily_return: number | null;
  snapshot_at: string | null; broker: string | null; credential_id: string | null;
  base_currency: string | null; balances: Record<string, unknown> | null;
  cash: number | null; equity: number | null; realized_pnl: number | null; unrealized_pnl: number | null;
  positions_count: number | null; total_value_usdt: number | null; created_at: string;
};

type ReportingTable<Row, Required extends keyof Row, Relationships extends readonly unknown[]> = {
  Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>; Relationships: Relationships;
};
export type ReportingTables = {
  live_strategies: ReportingTable<ReportingHeaderRow, "mode" | "user_id" | "workflow_id" | "name", [{
    foreignKeyName: "backtest_results_backtest_id_fkey"; columns: ["backtest_id"];
    isOneToOne: true; referencedRelation: "backtests"; referencedColumns: ["id"];
  }, {
    foreignKeyName: "live_strategies_workflow_id_fkey"; columns: ["workflow_id"];
    isOneToOne: false; referencedRelation: "workflows"; referencedColumns: ["id"];
  }]>;
  trades: ReportingTable<ReportingTradeRow, "live_strategy_id" | "symbol" | "action" | "quantity" | "exitPrice" | "exitTime", [{
    foreignKeyName: "trades_live_strategy_id_fkey"; columns: ["live_strategy_id"];
    isOneToOne: false; referencedRelation: "live_strategies"; referencedColumns: ["id"];
  }]>;
  portfolio: ReportingTable<ReportingPortfolioRow, "live_strategy_id", [{
    foreignKeyName: "portfolio_live_strategy_id_fkey"; columns: ["live_strategy_id"];
    isOneToOne: false; referencedRelation: "live_strategies"; referencedColumns: ["id"];
  }]>;
};
