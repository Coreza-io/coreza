-- Shared reporting for new backtests and live activations.
-- Deploy the schema and matching writers/readers together before resuming starts.
BEGIN;
CREATE TABLE public.live_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  backtest_id uuid UNIQUE REFERENCES public.backtests(id) ON DELETE CASCADE,
  execution_id uuid UNIQUE,
  name text NOT NULL,
  source_workflow_revision bigint,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  initial_capital numeric,
  base_currency text,
  metrics_updated_at timestamptz,
  metrics_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_return numeric,
  annualized_return numeric,
  sharpe_ratio numeric,
  sortino_ratio numeric,
  calmar_ratio numeric,
  max_drawdown numeric,
  win_rate numeric,
  profit_factor numeric,
  expectancy numeric,
  total_trades integer,
  profitable_trades integer,
  losing_trades integer,
  avg_win numeric,
  avg_loss numeric,
  largest_win numeric,
  largest_loss numeric,
  average_trade_return numeric,
  avg_holding_period numeric,
  net_profit numeric,
  final_portfolio_value numeric,
  total_commission numeric,
  total_slippage numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_mode_identity CHECK (
    (mode='backtest' AND backtest_id IS NOT NULL AND execution_id IS NULL) OR
    (mode='live' AND backtest_id IS NULL AND execution_id IS NOT NULL AND id=execution_id))
);
CREATE TABLE public.trades (
  id uuid PRIMARY KEY,
  live_strategy_id uuid NOT NULL REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  execution_id uuid,
  symbol text NOT NULL,
  action text NOT NULL,
  quantity numeric NOT NULL,
  "entryPrice" numeric,
  "exitPrice" numeric NOT NULL,
  "entryTime" timestamptz,
  "exitTime" timestamptz NOT NULL,
  commission numeric,
  slippage numeric,
  return_pct numeric,
  net_pnl numeric,
  gross_pnl numeric,
  portfolio_value_before numeric,
  portfolio_value_after numeric,
  holding_period_bars integer,
  exit_reason text,
  entry_order_id text,
  exit_order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.portfolio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_strategy_id uuid NOT NULL REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  execution_id uuid,
  date date,
  total_value numeric,
  cash_balance numeric,
  stock_value numeric,
  daily_return numeric,
  snapshot_at timestamptz,
  broker text,
  credential_id uuid,
  base_currency text,
  balances jsonb,
  cash numeric,
  equity numeric,
  realized_pnl numeric,
  unrealized_pnl numeric,
  positions_count integer,
  total_value_usdt numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(live_strategy_id,date)
);
CREATE INDEX live_strategies_owner_mode_start ON public.live_strategies(user_id,mode,started_at DESC,id DESC);
CREATE INDEX live_strategies_owner_mode_status ON public.live_strategies(user_id,mode,status);
CREATE INDEX trades_strategy_exit ON public.trades(live_strategy_id,"exitTime",id);
CREATE INDEX portfolio_strategy_snapshot ON public.portfolio(live_strategy_id,snapshot_at,id);
CREATE INDEX portfolio_snapshot_source ON public.portfolio(live_strategy_id,broker,credential_id,base_currency,snapshot_at,id);

-- Validate identity even for service-role writes. Historical names/revisions stay captured.
CREATE OR REPLACE FUNCTION public.validate_reporting_scope() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent public.live_strategies;
BEGIN
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Reporting ID is immutable'; END IF;
  IF TG_TABLE_NAME='live_strategies' THEN
    IF NOT EXISTS(SELECT 1 FROM public.workflows w WHERE w.id=NEW.workflow_id AND w.user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Reporting workflow ownership mismatch'; END IF;
    IF NEW.mode='backtest' AND NOT EXISTS(SELECT 1 FROM public.backtests b WHERE b.id=NEW.backtest_id AND b.workflow_id=NEW.workflow_id AND b.user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Reporting backtest identity mismatch'; END IF;
    IF NEW.mode='live' AND NEW.status IN ('completed','failed','cancelled') AND
      (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      NEW.metrics_context:=NEW.metrics_context || '{"finalization_pending":true}'::jsonb;
    END IF;
    IF TG_OP='UPDATE' AND (NEW.mode,NEW.user_id,NEW.workflow_id,NEW.backtest_id,NEW.execution_id) IS DISTINCT FROM (OLD.mode,OLD.user_id,OLD.workflow_id,OLD.backtest_id,OLD.execution_id) THEN
      RAISE EXCEPTION 'Reporting identity is immutable'; END IF;
  ELSE
    IF TG_OP='UPDATE' AND NEW.live_strategy_id IS DISTINCT FROM OLD.live_strategy_id THEN
      RAISE EXCEPTION 'Reporting child parent is immutable'; END IF;
    SELECT * INTO STRICT parent FROM public.live_strategies WHERE id=NEW.live_strategy_id;
    IF (NEW.user_id IS NOT NULL AND NEW.user_id<>parent.user_id) OR
       (NEW.workflow_id IS NOT NULL AND NEW.workflow_id<>parent.workflow_id) OR
       (NEW.execution_id IS NOT NULL AND NEW.execution_id IS DISTINCT FROM parent.execution_id) THEN
      RAISE EXCEPTION 'Reporting child identity mismatch'; END IF;
    NEW.user_id:=parent.user_id; NEW.workflow_id:=parent.workflow_id;
    IF TG_TABLE_NAME='portfolio' THEN
      IF (parent.mode='live' AND NEW.snapshot_at IS NULL) OR (parent.mode='backtest' AND NEW.date IS NULL) THEN
        RAISE EXCEPTION 'Reporting snapshot source timestamp missing'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_header_scope BEFORE INSERT OR UPDATE ON public.live_strategies FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();
CREATE TRIGGER reporting_trade_scope BEFORE INSERT OR UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();
CREATE TRIGGER reporting_portfolio_scope BEFORE INSERT OR UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();

-- Backtests remains the lifecycle authority, including all cancellation/failure paths.
CREATE OR REPLACE FUNCTION public.mirror_backtest_reporting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>NEW.user_id THEN RAISE EXCEPTION 'Backtest ownership mismatch'; END IF;
  INSERT INTO public.live_strategies(backtest_id,mode,user_id,workflow_id,name,status,started_at,completed_at,error_message,initial_capital,source_workflow_revision,metrics_context)
  VALUES(NEW.id,'backtest',NEW.user_id,NEW.workflow_id,NEW.name,NEW.status,NEW.started_at,NEW.completed_at,NEW.error_message,NEW.initial_capital,(SELECT revision FROM public.workflows WHERE id=NEW.workflow_id),
    '{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}')
  ON CONFLICT(backtest_id) DO UPDATE SET status=EXCLUDED.status,started_at=EXCLUDED.started_at,
    completed_at=EXCLUDED.completed_at,error_message=EXCLUDED.error_message,updated_at=now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mirror_backtest_reporting() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER backtest_reporting_lifecycle AFTER INSERT OR UPDATE OF status,started_at,completed_at,error_message ON public.backtests FOR EACH ROW EXECUTE FUNCTION public.mirror_backtest_reporting();

-- Atomically accept one activation before allocating resources. Only the backend may call.
CREATE OR REPLACE FUNCTION public.claim_reporting_activation(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF w.is_active THEN RAISE EXCEPTION 'Workflow is already active'; END IF;
  INSERT INTO public.live_strategies(id,mode,user_id,workflow_id,execution_id,name,status,started_at,source_workflow_revision,metrics_context)
  VALUES(p_execution_id,'live',p_user_id,p_workflow_id,p_execution_id,w.name,'pending',now(),w.revision,
    '{"source":"live","granularity":"intraday","initial_capital":"unavailable","average_trade_return_unit":"percent","avg_holding_period_unit":"milliseconds"}');
  UPDATE public.workflows SET is_active=true,active_execution_id=p_execution_id,updated_at=now() WHERE id=w.id;
END $$;
REVOKE ALL ON FUNCTION public.claim_reporting_activation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reporting_activation(uuid,uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.complete_reporting_activation(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_schedule_cron text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF NOT w.is_active OR w.active_execution_id IS DISTINCT FROM p_execution_id THEN
    RAISE EXCEPTION 'Activation ownership changed during startup'; END IF;
  UPDATE public.live_strategies SET status='running',updated_at=now()
    WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Activation is no longer pending'; END IF;
  UPDATE public.workflows SET schedule_cron=p_schedule_cron,updated_at=now() WHERE id=w.id RETURNING * INTO w;
  RETURN to_jsonb(w);
END $$;
REVOKE ALL ON FUNCTION public.complete_reporting_activation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_reporting_activation(uuid,uuid,uuid,text) TO service_role;

-- Reporting is written by the backend and read through parent ownership.
ALTER TABLE public.live_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.live_strategies,public.trades,public.portfolio TO authenticated;
GRANT ALL ON public.live_strategies,public.trades,public.portfolio TO service_role;
CREATE POLICY reporting_owner ON public.live_strategies FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY reporting_trade_owner ON public.trades FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
CREATE POLICY reporting_portfolio_owner ON public.portfolio FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
DO $$ DECLARE t text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['live_strategies','trades','portfolio'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Sufficient trade statistics for the portable metric helper. No equity-history scan
-- is performed by the five-second worker refresh; full risk metrics use paged history.
CREATE OR REPLACE FUNCTION public.reporting_trade_aggregate(p_live_strategy_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'count',count(*),'wins',count(*) FILTER(WHERE net_pnl>0),'losses',count(*) FILTER(WHERE net_pnl<0),
    'pnl',coalesce(sum(net_pnl),0),'win_pnl',coalesce(sum(net_pnl) FILTER(WHERE net_pnl>0),0),
    'loss_pnl',coalesce(sum(net_pnl) FILTER(WHERE net_pnl<0),0),
    'largest_win',coalesce(max(net_pnl) FILTER(WHERE net_pnl>0),0),
    'largest_loss',min(net_pnl) FILTER(WHERE net_pnl<0),
    'commission',coalesce(sum(commission),0),'slippage',coalesce(sum(slippage),0),
    'holding_ms',avg(extract(epoch FROM ("exitTime"-"entryTime"))*1000) FILTER(WHERE "exitTime">="entryTime")
  ) FROM public.trades WHERE live_strategy_id=p_live_strategy_id;
$$;
REVOKE ALL ON FUNCTION public.reporting_trade_aggregate(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_trade_aggregate(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.mark_reporting_changes() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  UPDATE public.live_strategies r SET metrics_context=r.metrics_context || jsonb_build_object(
    'refresh_pending',true,'data_revision',(coalesce((r.metrics_context->>'data_revision')::bigint,0)+1)::text,
    'finalization_pending',r.status IN ('completed','failed','cancelled') OR coalesce((r.metrics_context->>'finalization_pending')::boolean,false))
  WHERE r.mode='live' AND r.id IN (SELECT DISTINCT live_strategy_id FROM reporting_changed);
  RETURN NULL;
END $$;
CREATE TRIGGER reporting_trade_inserted AFTER INSERT ON public.trades REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_trade_updated AFTER UPDATE ON public.trades REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_snapshot_inserted AFTER INSERT ON public.portfolio REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_snapshot_updated AFTER UPDATE ON public.portfolio REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE INDEX live_strategies_pending_metrics ON public.live_strategies(id) WHERE mode='live' AND
  (metrics_updated_at IS NULL OR metrics_context->>'refresh_pending'='true' OR metrics_context->>'finalization_pending'='true');

-- Serialize resource cleanup across competing stop/delete requests. A process that
-- dies with a stop in progress retains ownership for explicit lifecycle recovery.
CREATE OR REPLACE FUNCTION public.claim_reporting_stop(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows; r public.live_strategies;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF NOT w.is_active OR w.active_execution_id IS DISTINCT FROM p_execution_id THEN RETURN false; END IF;
  SELECT * INTO STRICT r FROM public.live_strategies WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id FOR UPDATE;
  IF r.status='pending' THEN RAISE EXCEPTION 'Activation is still starting'; END IF;
  IF r.metrics_context ? 'stop_token' THEN RAISE EXCEPTION 'Activation stop is in progress'; END IF;
  UPDATE public.live_strategies SET metrics_context=metrics_context || jsonb_build_object('stop_token',p_token::text,'data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text) WHERE id=r.id;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.release_reporting_stop(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_token uuid)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  UPDATE public.live_strategies SET metrics_context=(metrics_context-'stop_token') || jsonb_build_object('data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text)
    WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id AND metrics_context->>'stop_token'=p_token::text;
$$;
REVOKE ALL ON FUNCTION public.claim_reporting_stop(uuid,uuid,uuid,uuid),public.release_reporting_stop(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reporting_stop(uuid,uuid,uuid,uuid),public.release_reporting_stop(uuid,uuid,uuid,uuid) TO service_role;


-- Capture an explicitly supplied equity baseline once, tied to its account/currency.
CREATE OR REPLACE FUNCTION public.record_reporting_baseline(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_capital numeric,p_source jsonb)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  UPDATE public.live_strategies SET initial_capital=p_capital,base_currency=p_source->>'base_currency',
    metrics_context=metrics_context || jsonb_build_object('initial_capital','recorded','snapshot_source',p_source,
      'refresh_pending',true,'data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text)
  WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id
    AND status IN ('pending','running') AND initial_capital IS NULL AND p_capital>0
    AND (NOT(metrics_context ? 'snapshot_source') OR metrics_context->'snapshot_source'=p_source);
$$;
REVOKE ALL ON FUNCTION public.record_reporting_baseline(uuid,uuid,uuid,numeric,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_reporting_baseline(uuid,uuid,uuid,numeric,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
