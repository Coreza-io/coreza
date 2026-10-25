-- Broker events only. No historical accounting is rewritten or automatically baselined.
CREATE TABLE public.broker_fill_portfolios (
  scope_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  broker text NOT NULL,
  account_id text NOT NULL CHECK (account_id <> ''),
  environment text NOT NULL CHECK (environment <> ''),
  version bigint NOT NULL DEFAULT 0,
  baseline_at timestamptz NOT NULL,
  state jsonb NOT NULL,
  checkpoints jsonb NOT NULL DEFAULT '{}',
  UNIQUE (user_id, broker, account_id, environment)
);
CREATE TABLE public.broker_fill_events (
  scope_id text NOT NULL REFERENCES public.broker_fill_portfolios(scope_id),
  receipt_id text NOT NULL,
  order_id text,
  execution_key text,
  portfolio_version bigint NOT NULL,
  decision jsonb NOT NULL,
  checkpoint jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, receipt_id),
  UNIQUE (scope_id, execution_key)
);
CREATE TABLE public.broker_fill_outbox (
  scope_id text NOT NULL,
  receipt_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (scope_id, receipt_id),
  FOREIGN KEY (scope_id, receipt_id) REFERENCES public.broker_fill_events(scope_id, receipt_id)
);
CREATE INDEX broker_fill_outbox_pending ON public.broker_fill_outbox(created_at) WHERE delivered_at IS NULL;

ALTER TABLE public.broker_fill_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_fill_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_fill_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_fill_portfolios, public.broker_fill_events, public.broker_fill_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.broker_fill_portfolios TO service_role;
GRANT SELECT, INSERT ON public.broker_fill_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.broker_fill_outbox TO service_role;

ALTER TABLE public.live_fills ADD COLUMN IF NOT EXISTS broker_account_id text NOT NULL DEFAULT '';
ALTER TABLE public.live_fills ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX live_fills_account_identity ON public.live_fills(user_id, broker, broker_account_id, environment, symbol, fill_id);
ALTER TABLE public.live_trades ADD COLUMN IF NOT EXISTS trade_key text;
ALTER TABLE public.live_trades ADD COLUMN IF NOT EXISTS broker_account_id text;
ALTER TABLE public.live_trades ADD COLUMN IF NOT EXISTS environment text;
CREATE UNIQUE INDEX live_trades_stable_identity ON public.live_trades(trade_key);

-- The locked portfolio version is also the writer fence. Every financial writer must use it.
-- The caller stages against p_version; a losing caller must recover and normalize again.
CREATE FUNCTION public.commit_broker_fill(
  p_scope text, p_workflow uuid, p_version bigint, p_receipt text,
  p_order text, p_execution text, p_checkpoint jsonb, p_state jsonb,
  p_fill jsonb, p_trade jsonb, p_decision jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  portfolio public.broker_fill_portfolios%ROWTYPE;
BEGIN
  SELECT * INTO STRICT portfolio FROM public.broker_fill_portfolios WHERE scope_id = p_scope FOR UPDATE;
  IF portfolio.workflow_id <> p_workflow THEN RAISE EXCEPTION 'Competing broker account owner'; END IF;
  IF EXISTS (SELECT 1 FROM public.broker_fill_events WHERE scope_id = p_scope AND receipt_id = p_receipt) THEN
    RETURN jsonb_build_object('kind', 'duplicate');
  END IF;
  IF portfolio.version <> p_version THEN RETURN jsonb_build_object('kind', 'conflict'); END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' THEN RAISE EXCEPTION 'Missing recoverable portfolio state'; END IF;
  IF p_execution IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.broker_fill_events WHERE scope_id = p_scope AND execution_key = p_execution
  ) THEN RETURN jsonb_build_object('kind', 'conflict'); END IF;
  IF p_order IS NOT NULL AND p_checkpoint IS NULL THEN RAISE EXCEPTION 'Missing order checkpoint'; END IF;
  IF p_checkpoint IS NOT NULL AND (
    (p_checkpoint->>'quantity')::numeric < COALESCE((portfolio.checkpoints->p_order->>'quantity')::numeric, 0)
    OR (p_checkpoint->>'notional')::numeric < COALESCE((portfolio.checkpoints->p_order->>'notional')::numeric, 0)
  ) THEN RAISE EXCEPTION 'Checkpoint regression'; END IF;

  INSERT INTO public.broker_fill_events(scope_id, receipt_id, order_id, execution_key, portfolio_version, decision, checkpoint)
    VALUES(p_scope, p_receipt, p_order, p_execution, p_version + 1, p_decision, p_checkpoint);
  UPDATE public.broker_fill_portfolios SET state = p_state, version = version + 1,
    checkpoints = CASE WHEN p_order IS NULL THEN checkpoints ELSE jsonb_set(checkpoints, ARRAY[p_order], p_checkpoint) END
    WHERE scope_id = p_scope;

  -- Fill/trade sinks participate in the very same transaction as accounting and receipt.
  IF p_fill IS NOT NULL THEN
    IF p_fill->>'user_id' <> portfolio.user_id::text OR p_fill->>'workflow_id' <> portfolio.workflow_id::text
      OR p_fill->>'broker_account_id' <> portfolio.account_id OR p_fill->>'environment' <> portfolio.environment
      OR p_fill->>'broker' <> portfolio.broker THEN RAISE EXCEPTION 'Fill scope mismatch'; END IF;
    INSERT INTO public.live_fills(
      user_id, broker, credential_id, broker_account_id, environment, symbol, fill_id, order_id,
      broker_execution_id, side, price, qty, quote_qty, commission, commission_asset,
      event_time, workflow_id, execution_id, fill_status, tag
    ) VALUES (
      portfolio.user_id, portfolio.broker, (p_fill->>'credential_id')::uuid, portfolio.account_id, portfolio.environment,
      p_fill->>'symbol', p_fill->>'fill_id', p_fill->>'order_id', p_fill->>'broker_execution_id', p_fill->>'side',
      (p_fill->>'fill_price')::numeric, (p_fill->>'fill_qty_delta')::numeric, (p_fill->>'quote_qty')::numeric,
      COALESCE((p_fill->>'commission')::numeric, 0), p_fill->>'commission_asset', (p_fill->>'event_time')::timestamptz,
      portfolio.workflow_id, (p_fill->>'execution_id')::uuid, p_fill->>'fill_status', p_fill->>'tag'
    ) ON CONFLICT (user_id, broker, broker_account_id, environment, symbol, fill_id) DO NOTHING;
    INSERT INTO public.broker_fill_outbox(scope_id, receipt_id, payload) VALUES(p_scope, p_receipt, p_fill);
  END IF;
  IF p_trade IS NOT NULL THEN
    IF p_trade->>'user_id' <> portfolio.user_id::text OR p_trade->>'workflow_id' <> portfolio.workflow_id::text
      THEN RAISE EXCEPTION 'Trade owner mismatch'; END IF;
    INSERT INTO public.live_trades(
      trade_key, user_id, workflow_id, execution_id, broker_account_id, environment, symbol, action, quantity,
      "entryPrice", "entryTime", "exitPrice", "exitTime", commission, slippage, net_pnl, gross_pnl,
      entry_order_id, exit_order_id, holding_period_bars
    ) SELECT x.trade_key, x.user_id, x.workflow_id, x.execution_id, x.broker_account_id, x.environment,
      x.symbol, x.action, x.quantity, x."entryPrice", x."entryTime", x."exitPrice", x."exitTime",
      x.commission, x.slippage, x.net_pnl, x.gross_pnl, x.entry_order_id, x.exit_order_id, x.holding_period_bars
      FROM jsonb_populate_record(NULL::public.live_trades, p_trade) x
    ON CONFLICT (trade_key) DO UPDATE SET quantity = EXCLUDED.quantity,
      "exitPrice" = EXCLUDED."exitPrice", "exitTime" = EXCLUDED."exitTime",
      commission = EXCLUDED.commission, net_pnl = EXCLUDED.net_pnl, gross_pnl = EXCLUDED.gross_pnl;
  END IF;
  RETURN jsonb_build_object('kind', 'committed', 'version', (p_version + 1)::text);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_broker_fill(text, uuid, bigint, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_broker_fill(text, uuid, bigint, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMENT ON TABLE public.broker_fill_portfolios IS 'Seed only while ingestion is paused from reconciled broker executions, cash, fees, orders and pending closing trades. Never seed a partly filled order at zero. No automatic ownership transfer.';
