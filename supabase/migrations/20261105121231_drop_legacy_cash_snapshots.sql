-- Apply manually after the rollout prerequisites in
-- docs/cash-snapshots-removal-plan.md#rollout have been completed.
-- Keep out of automatic deployment until all shared-database consumers and
-- rollback versions have moved off this table, legacy rows have been recounted
-- and archived in restricted storage, and restoration has been verified.
-- Recheck dependencies before applying; RESTRICT must fail on dependencies.
-- Rollback: restore the table, grants, policies and archived rows before
-- deploying any version that requires cash_snapshots.
DROP TABLE IF EXISTS public.cash_snapshots RESTRICT;
