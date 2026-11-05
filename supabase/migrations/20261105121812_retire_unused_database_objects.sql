-- Manual rollout only: see docs/database-retirement-audit.md.
-- Deploy all consumers first. Recheck external readers, scheduled jobs and
-- rollback versions. Do not include in automatic deployment.
-- Historical rows and receipts are intentionally discarded; no archive is required.
-- RESTRICT intentionally rejects unexpected dependencies; never use CASCADE.
BEGIN;

-- Refuse to discard ownership or checkpoint state before it has been drained.
DO $$
BEGIN
  IF to_regclass('public.workflow_live_variable_state') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.workflow_live_variable_state WHERE phase <> 'idle') THEN
      RAISE EXCEPTION 'Drain or recover legacy live variable scopes before retirement';
    END IF;
  END IF;
END;
$$;

-- Keep signup/profile creation while retiring its obsolete billing side effect.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (user_id, first_name, last_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'first_name', ''), COALESCE(NEW.raw_user_meta_data->>'last_name', ''));
  RETURN NEW;
END;
$$;

-- Remove all scoped and global overloads, including the renamed legacy writer.
DROP FUNCTION IF EXISTS
  public.workflow_live_variables(text, uuid, uuid, jsonb),
  public.validate_live_variable_checkpoint(text, text, uuid, uuid),
  public.commit_workflow_variables(uuid, uuid, text, text, jsonb),
  public.commit_workflow_variables_legacy(uuid, uuid, text, text, jsonb),
  public.mutate_workflow_variable(uuid, text, text, text, jsonb),
  public.workflow_variables_snapshot(uuid, uuid),
  public.workflow_variables_snapshot(uuid),
  public.workflow_variables_revision(uuid, uuid),
  public.workflow_variables_revision(uuid),
  public.check_execution_limit(uuid),
  public.get_current_usage(uuid),
  public.increment_execution_count(uuid),
  public.get_user_tier(uuid),
  public.validate_workflow_run_scope()
RESTRICT;

DROP TABLE IF EXISTS
  public.workflow_live_variable_state,
  public.workflow_variables,
  public.workflow_variable_revisions,
  public.live_trades,
  public.backtest_results,
  public.backtest_trades,
  public.backtest_portfolio_snapshots,
  public.position_snapshots,
  public.subscriptions,
  public.usage_metrics
RESTRICT;

DROP TYPE IF EXISTS public.subscription_status, public.subscription_tier RESTRICT;

COMMIT;
