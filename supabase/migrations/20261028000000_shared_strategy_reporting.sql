-- Coordinated cutover: pause starts/writers and drain before applying; deploy readers
-- and writers together. This migration never stops or restarts a trading strategy.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.live_strategies') IS NULL THEN
    ALTER TABLE public.backtest_results RENAME TO live_strategies;
    ALTER TABLE public.backtest_trades RENAME TO trades;
    ALTER TABLE public.backtest_portfolio_snapshots RENAME TO portfolio;
  END IF;
END $$;

ALTER TABLE public.live_strategies
  ALTER COLUMN backtest_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'backtest',
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS source_workflow_revision bigint,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS initial_capital numeric,
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS metrics_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_context jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Refuse ambiguous legacy summaries instead of dropping or merging financial rows.
CREATE UNIQUE INDEX IF NOT EXISTS live_strategies_backtest ON public.live_strategies(backtest_id);
CREATE UNIQUE INDEX IF NOT EXISTS live_strategies_execution ON public.live_strategies(execution_id);
UPDATE public.live_strategies r SET user_id=b.user_id, workflow_id=b.workflow_id,
  name=b.name, status=b.status, started_at=b.started_at, completed_at=b.completed_at,
  error_message=b.error_message, initial_capital=b.initial_capital,
  metrics_context='{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}'
FROM public.backtests b WHERE r.backtest_id=b.id;
INSERT INTO public.live_strategies(backtest_id,user_id,workflow_id,name,status,started_at,completed_at,error_message,initial_capital,created_at,metrics_context)
SELECT b.id,b.user_id,b.workflow_id,b.name,b.status,b.started_at,b.completed_at,b.error_message,b.initial_capital,b.created_at,
  '{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}'::jsonb
FROM public.backtests b WHERE NOT EXISTS (SELECT 1 FROM public.live_strategies r WHERE r.backtest_id=b.id);

ALTER TABLE public.trades
  ALTER COLUMN backtest_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS live_strategy_id uuid REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS gross_pnl numeric,
  ADD COLUMN IF NOT EXISTS entry_order_id text,
  ADD COLUMN IF NOT EXISTS exit_order_id text;
ALTER TABLE public.portfolio
  ALTER COLUMN backtest_id DROP NOT NULL,
  ALTER COLUMN date DROP NOT NULL,
  ALTER COLUMN date DROP DEFAULT,
  ALTER COLUMN total_value DROP DEFAULT,
  ALTER COLUMN cash_balance DROP DEFAULT,
  ALTER COLUMN stock_value DROP DEFAULT,
  ALTER COLUMN daily_return DROP DEFAULT,
  ALTER COLUMN total_value DROP NOT NULL,
  ALTER COLUMN cash_balance DROP NOT NULL,
  ALTER COLUMN stock_value DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS live_strategy_id uuid REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS broker text,
  ADD COLUMN IF NOT EXISTS credential_id uuid,
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS balances jsonb,
  ADD COLUMN IF NOT EXISTS cash numeric,
  ADD COLUMN IF NOT EXISTS equity numeric,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS unrealized_pnl numeric,
  ADD COLUMN IF NOT EXISTS positions_count integer,
  ADD COLUMN IF NOT EXISTS total_value_usdt numeric;
UPDATE public.trades c SET live_strategy_id=r.id,user_id=r.user_id,workflow_id=r.workflow_id
FROM public.live_strategies r WHERE c.backtest_id=r.backtest_id;
UPDATE public.portfolio c SET live_strategy_id=r.id,user_id=r.user_id,workflow_id=r.workflow_id
FROM public.live_strategies r WHERE c.backtest_id=r.backtest_id;

-- Only reliable, owned activation groups qualify. Technical event run IDs do not.
CREATE TEMP TABLE reporting_legacy_activations ON COMMIT DROP AS
WITH evidence AS (
  SELECT workflow_id,user_id,execution_id,coalesce("entryTime","exitTime") AS observed_at FROM public.live_trades
  UNION ALL SELECT workflow_id,user_id,execution_id,snapshot_at FROM public.cash_snapshots
  UNION ALL SELECT w.id,w.user_id,w.active_execution_id,NULL::timestamptz FROM public.workflows w
    WHERE w.is_active AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.nodes)='array' THEN w.nodes ELSE '[]'::jsonb END) n
      WHERE 'portfolio'=lower(coalesce(n->>'type',n->>'name',n->>'def',n->>'node_type',''))
        AND coalesce(n#>>'{values,mode}',n#>>'{data,values,mode}',n#>>'{data,config,mode}',n#>>'{data,mode}')='broker'
    ) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.nodes)='array' THEN w.nodes ELSE '[]'::jsonb END) n WHERE lower(coalesce(n->>'type',n->>'name',''))='backtestinit')
  UNION ALL SELECT r.workflow_id,r.initiated_by,r.execution_id,r.started_at FROM public.workflow_runs r
    WHERE r.execution_id IS NOT NULL AND r.execution_id<>r.id AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.nodes)='array' THEN r.nodes ELSE '[]'::jsonb END) n
      WHERE lower(coalesce(n->>'type',n->>'name',n->>'def',n->>'node_type',''))='portfolio'
        AND coalesce(n#>>'{values,mode}',n#>>'{data,values,mode}',n#>>'{data,config,mode}',n#>>'{data,mode}')='broker'
    )
)
SELECT e.workflow_id,e.user_id,e.execution_id,min(e.observed_at) AS first_observed_at
FROM evidence e JOIN public.workflows w ON w.id=e.workflow_id AND w.user_id=e.user_id
WHERE e.execution_id IS NOT NULL
GROUP BY e.workflow_id,e.user_id,e.execution_id;
DO $$ BEGIN
  IF EXISTS (SELECT execution_id FROM reporting_legacy_activations GROUP BY execution_id HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM reporting_legacy_activations a JOIN public.live_strategies r ON r.id=a.execution_id
      WHERE r.mode<>'live' OR r.execution_id IS DISTINCT FROM a.execution_id OR r.workflow_id<>a.workflow_id OR r.user_id<>a.user_id)
  THEN RAISE EXCEPTION 'Conflicting reporting activation UUID; reconcile before cutover'; END IF;
END $$;
INSERT INTO public.live_strategies(id,mode,user_id,workflow_id,execution_id,name,status,started_at,metrics_context)
SELECT a.execution_id,'live',a.user_id,a.workflow_id,a.execution_id,w.name,
  CASE WHEN w.is_active AND w.active_execution_id=a.execution_id THEN 'running' ELSE 'cancelled' END,
  a.first_observed_at,
  jsonb_build_object('source','live','granularity','intraday','legacy',true,
    'lifecycle_unknown',NOT coalesce(w.is_active AND w.active_execution_id=a.execution_id,false),
    'started_at_inferred',true,'initial_capital','unavailable',
    'average_trade_return_unit','percent','avg_holding_period_unit','milliseconds')
FROM reporting_legacy_activations a JOIN public.workflows w ON w.id=a.workflow_id
ON CONFLICT (execution_id) DO NOTHING;

-- Source UUIDs are retry identities. Never deduplicate partial exits by order/time.
INSERT INTO public.trades(id,live_strategy_id,user_id,workflow_id,execution_id,symbol,action,quantity,
  "entryPrice","exitPrice","entryTime","exitTime",commission,slippage,net_pnl,gross_pnl,entry_order_id,exit_order_id,holding_period_bars,exit_reason,created_at)
SELECT t.id,r.id,t.user_id,t.workflow_id,t.execution_id,t.symbol,t.action,t.quantity,
  t."entryPrice",t."exitPrice",t."entryTime",t."exitTime",t.commission,t.slippage,t.net_pnl,t.gross_pnl,t.entry_order_id,t.exit_order_id,t.holding_period_bars,t.exit_reason,t.created_at
FROM public.live_trades t JOIN public.live_strategies r ON r.execution_id=t.execution_id AND r.workflow_id=t.workflow_id AND r.user_id=t.user_id AND r.mode='live';
INSERT INTO public.portfolio(id,live_strategy_id,user_id,workflow_id,execution_id,snapshot_at,broker,credential_id,base_currency,balances,cash,equity,realized_pnl,unrealized_pnl,positions_count,total_value_usdt,created_at)
SELECT c.id,r.id,c.user_id,c.workflow_id,c.execution_id,c.snapshot_at,c.broker,c.credential_id,c.base_currency,c.balances,c.cash,c.equity,c.realized_pnl,c.unrealized_pnl,c.positions_count,c.total_value_usdt,c.created_at
FROM public.cash_snapshots c JOIN public.live_strategies r ON r.execution_id=c.execution_id AND r.workflow_id=c.workflow_id AND r.user_id=c.user_id AND r.mode='live';

ALTER TABLE public.live_strategies ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL, ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.live_strategies ADD CONSTRAINT reporting_mode_identity CHECK (
  (mode='backtest' AND backtest_id IS NOT NULL AND execution_id IS NULL) OR
  (mode='live' AND backtest_id IS NULL AND execution_id IS NOT NULL AND id=execution_id));
ALTER TABLE public.live_strategies ADD CONSTRAINT reporting_status CHECK (status IN ('pending','running','completed','failed','cancelled'));
ALTER TABLE public.trades ALTER COLUMN live_strategy_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL;
ALTER TABLE public.portfolio ALTER COLUMN live_strategy_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL;
CREATE INDEX live_strategies_owner_mode_start ON public.live_strategies(user_id,mode,started_at DESC,id DESC);
CREATE INDEX live_strategies_owner_mode_status ON public.live_strategies(user_id,mode,status);
CREATE INDEX trades_strategy_exit ON public.trades(live_strategy_id,"exitTime",id);
CREATE INDEX portfolio_strategy_snapshot ON public.portfolio(live_strategy_id,snapshot_at,id);
CREATE UNIQUE INDEX portfolio_strategy_date ON public.portfolio(live_strategy_id,date);
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
       (NEW.backtest_id IS NOT NULL AND NEW.backtest_id IS DISTINCT FROM parent.backtest_id) OR
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

-- Remove legacy policies after rename: child access follows the owned parent only.
DO $$ DECLARE p record; t text; BEGIN
  FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('live_strategies','trades','portfolio') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['live_strategies','trades','portfolio'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END $$;
CREATE POLICY reporting_owner ON public.live_strategies FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY reporting_trade_owner ON public.trades FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
CREATE POLICY reporting_portfolio_owner ON public.portfolio FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
-- Old live tables remain rollback sources; account-level cash snapshots remain operational.
REVOKE INSERT,UPDATE,DELETE ON public.live_trades FROM authenticated;
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
