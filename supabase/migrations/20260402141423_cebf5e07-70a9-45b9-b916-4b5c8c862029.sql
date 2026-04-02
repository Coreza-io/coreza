CREATE TABLE public.live_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workflow_id uuid,
  run_id uuid,
  symbol text NOT NULL,
  action text NOT NULL,
  quantity numeric NOT NULL,
  "entryPrice" numeric,
  "entryTime" timestamptz,
  "exitPrice" numeric NOT NULL,
  "exitTime" timestamptz NOT NULL,
  commission numeric DEFAULT 0,
  slippage numeric DEFAULT 0,
  net_pnl numeric,
  gross_pnl numeric,
  entry_order_id text,
  exit_order_id text,
  holding_period_bars integer DEFAULT 0,
  exit_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own live trades"
  ON public.live_trades FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to live_trades"
  ON public.live_trades FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_live_trades_workflow ON public.live_trades (workflow_id, run_id);
CREATE INDEX idx_live_trades_user ON public.live_trades (user_id, workflow_id);