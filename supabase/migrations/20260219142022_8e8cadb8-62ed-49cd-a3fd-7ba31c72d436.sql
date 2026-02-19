
-- Add columns to backtest_trades
ALTER TABLE public.backtest_trades
  ADD COLUMN IF NOT EXISTS entry_price numeric,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS return_pct numeric,
  ADD COLUMN IF NOT EXISTS net_pnl numeric,
  ADD COLUMN IF NOT EXISTS holding_period_bars integer;

-- Add columns to backtest_results
ALTER TABLE public.backtest_results
  ADD COLUMN IF NOT EXISTS sortino_ratio numeric,
  ADD COLUMN IF NOT EXISTS calmar_ratio numeric,
  ADD COLUMN IF NOT EXISTS profit_factor numeric,
  ADD COLUMN IF NOT EXISTS avg_win numeric,
  ADD COLUMN IF NOT EXISTS avg_loss numeric,
  ADD COLUMN IF NOT EXISTS total_commission numeric,
  ADD COLUMN IF NOT EXISTS total_slippage numeric,
  ADD COLUMN IF NOT EXISTS net_profit numeric,
  ADD COLUMN IF NOT EXISTS losing_trades integer,
  ADD COLUMN IF NOT EXISTS expectancy numeric,
  ADD COLUMN IF NOT EXISTS avg_holding_period numeric;
