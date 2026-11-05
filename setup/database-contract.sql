-- Read-only installer preflight and post-install contract inventory.
WITH required_tables(name) AS (
  VALUES ('users'), ('projects'), ('workflows'), ('workflow_versions'),
    ('workflow_runs'), ('node_executions'), ('user_credentials'), ('backtests'),
    ('live_fills'), ('coreza_chat_history'), ('live_strategies'), ('trades'), ('portfolio')
), required_columns(table_name, column_name) AS (
  VALUES ('users','selected_markets'), ('workflows','revision'),
    ('workflows','node_clusters'), ('workflows','active_execution_id'),
    ('workflow_versions','node_clusters'), ('workflow_runs','node_clusters'),
    ('workflow_runs','source_workflow_revision'), ('workflow_runs','scope_kind'),
    ('workflow_runs','scope_cluster_id'), ('workflow_runs','scope_snapshot'),
    ('workflow_runs','idempotency_key'), ('workflow_runs','request_fingerprint'),
    ('workflow_runs','cancel_requested_at'), ('workflow_runs','cancel_acknowledged_at'),
    ('live_fills','algo_id'), ('portfolio','equity_open'), ('portfolio','equity_high'),
    ('portfolio','equity_low'), ('portfolio','equity_close'), ('portfolio','equity_sample_count')
), required_functions(signature) AS (
  VALUES ('update_updated_at_column()'), ('user_credentials_set_updated_at()'),
    ('handle_new_user()'), ('validate_workflow_run_contract()'),
    ('save_workflow_document(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,uuid,integer)'),
    ('guard_nested_workflow_writer()'), ('cluster_hierarchy_write_ready()'),
    ('validate_reporting_scope()'), ('mirror_backtest_reporting()'),
    ('claim_reporting_activation(uuid,uuid,uuid)'),
    ('complete_reporting_activation(uuid,uuid,uuid,text)'),
    ('reporting_trade_aggregate(uuid)'), ('mark_reporting_changes()'),
    ('claim_reporting_stop(uuid,uuid,uuid,uuid)'),
    ('release_reporting_stop(uuid,uuid,uuid,uuid)'),
    ('record_reporting_baseline(uuid,uuid,uuid,numeric,jsonb)')
), required_constraints(table_name, name) AS (
  VALUES ('users','users_selected_markets_allowed'), ('portfolio','portfolio_equity_ohlc_valid')
), required_triggers(schema_name, table_name, name) AS (
  VALUES ('auth','users','on_auth_user_created'),
    ('public','workflows','guard_nested_workflow_writer'),
    ('public','workflow_runs','workflow_runs_validate_contract'),
    ('public','backtests','backtest_reporting_lifecycle'),
    ('public','live_strategies','reporting_header_scope'),
    ('public','trades','reporting_trade_scope'),
    ('public','portfolio','reporting_portfolio_scope'),
    ('public','trades','reporting_trade_inserted'),
    ('public','trades','reporting_trade_updated'),
    ('public','portfolio','reporting_snapshot_inserted'),
    ('public','portfolio','reporting_snapshot_updated')
), missing(name) AS (
  SELECT 'table:public.' || name FROM required_tables
    WHERE pg_catalog.to_regclass('public.' || name) IS NULL
  UNION ALL
  SELECT 'column:public.' || r.table_name || '.' || r.column_name FROM required_columns r
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.' || r.table_name)
        AND a.attname=r.column_name AND NOT a.attisdropped)
  UNION ALL
  SELECT 'function:public.' || signature FROM required_functions
    WHERE pg_catalog.to_regprocedure('public.' || signature) IS NULL
  UNION ALL
  SELECT 'constraint:public.' || r.table_name || '.' || r.name FROM required_constraints r
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid=pg_catalog.to_regclass('public.' || r.table_name)
        AND c.conname=r.name AND c.convalidated)
  UNION ALL
  SELECT 'trigger:' || r.schema_name || '.' || r.table_name || '.' || r.name FROM required_triggers r
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=pg_catalog.to_regclass(r.schema_name || '.' || r.table_name)
        AND t.tgname=r.name AND t.tgenabled='O')
  UNION ALL
  SELECT 'RLS:public.' || r.name FROM required_tables r
    JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || r.name)
    WHERE NOT c.relrowsecurity
  UNION ALL
  SELECT 'authenticated SELECT:public.' || r.name FROM required_tables r
    JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || r.name)
    WHERE NOT pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
  UNION ALL
  SELECT 'service_role privileges:public.' || r.name FROM required_tables r
    JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || r.name)
    WHERE NOT (pg_catalog.has_table_privilege('service_role',c.oid,'SELECT')
      AND pg_catalog.has_table_privilege('service_role',c.oid,'INSERT')
      AND pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE')
      AND pg_catalog.has_table_privilege('service_role',c.oid,'DELETE'))
  UNION ALL
  SELECT 'writer grants:public.' || c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('workflows','workflow_runs','live_strategies','trades','portfolio')
      AND (pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')
        OR pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE')
        OR pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
        OR pg_catalog.has_table_privilege('anon',c.oid,'UPDATE'))
  UNION ALL
  SELECT 'RPC grants:public.' || r.signature FROM required_functions r
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.' || r.signature)
    WHERE p.prorettype <> 'pg_catalog.trigger'::regtype
      AND (NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'))
  UNION ALL
  SELECT 'index:public.idx_workflow_runs_schedule_key_unique'
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
      WHERE i.indexrelid=pg_catalog.to_regclass('public.idx_workflow_runs_schedule_key_unique')
        AND i.indrelid=pg_catalog.to_regclass('public.workflow_runs')
        AND i.indisunique AND i.indisvalid AND NOT i.indnullsnotdistinct
        AND pg_catalog.pg_get_expr(i.indpred,i.indrelid)='(schedule_key IS NOT NULL)')
  UNION ALL
  SELECT 'Realtime:public.' || r.name FROM (VALUES ('workflows'),('live_strategies'),('trades'),('portfolio')) r(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables p
      WHERE p.pubname='supabase_realtime' AND p.schemaname='public' AND p.tablename=r.name)
)
SELECT (
  (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'))
  + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
)::integer AS public_objects,
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS history_present,
  COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM missing),'[]'::jsonb) AS missing;
