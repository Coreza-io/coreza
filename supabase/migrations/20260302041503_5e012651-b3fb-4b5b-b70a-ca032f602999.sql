
-- ============== LIVE FILLS (Event-sourced fill ledger) ==============
CREATE TABLE public.live_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker text NOT NULL,
  credential_id uuid NOT NULL,
  symbol text NOT NULL,
  trade_id text NOT NULL,
  order_id text,
  side text NOT NULL,
  qty numeric NOT NULL,
  price numeric NOT NULL,
  quote_qty numeric,
  commission numeric NOT NULL DEFAULT 0,
  commission_asset text,
  event_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_live_fills_dedup UNIQUE (user_id, broker, symbol, trade_id)
);

ALTER TABLE public.live_fills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own fills"
  ON public.live_fills FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own fills"
  ON public.live_fills FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to live_fills"
  ON public.live_fills FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for incremental sync queries
CREATE INDEX idx_live_fills_user_symbol ON public.live_fills (user_id, broker, symbol, trade_id);

-- ============== POSITION SNAPSHOTS ==============
CREATE TABLE public.position_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker text NOT NULL,
  credential_id uuid NOT NULL,
  symbol text NOT NULL,
  quantity numeric NOT NULL,
  avg_entry_price numeric NOT NULL,
  current_price numeric,
  unrealized_pnl numeric,
  realized_pnl numeric,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.position_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own position snapshots"
  ON public.position_snapshots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own position snapshots"
  ON public.position_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to position_snapshots"
  ON public.position_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============== CASH SNAPSHOTS ==============
CREATE TABLE public.cash_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker text NOT NULL,
  credential_id uuid NOT NULL,
  balances jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_value_usdt numeric,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cash snapshots"
  ON public.cash_snapshots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cash snapshots"
  ON public.cash_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to cash_snapshots"
  ON public.cash_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
