# Installing and upgrading Coreza

Run `node setup/setup.js` from the repository root. The Windows launcher runs this
same installer before starting the services. Setup uses Supabase CLI **3.0.0**,
with an explicit remote target for database changes. Supply the project URL,
publishable key, secret key, personal access token, and database password when
prompted. Existing environment-file values are reused, including the backend
encryption key.

Backend environment defaults come from `coreza-backend/.env.example`, including
Redis/BullMQ, ports, workflow attempts, listener/polling limits, backtest mode,
logging and live timing. Setup preserves existing values for those template keys
and fills missing values from the example. A legacy `REDIS_URL` is carried into
`REDIS_QUEUE_URL` and `REDIS_CACHE_URL` unless dedicated URLs already exist.
The market-stream environment is generated from
`coreza-backend/market-stream-service/.env.example` with the same preservation
and legacy Redis URL rules, including its port, Redis TLS, logging and timing
settings. `WEBSOCKET_PORT` belongs to the backend and is not generated for the
market-stream service; its HTTP listener uses `MARKET_STREAM_PORT`.
Broker OAuth callback URL variables are no longer generated. New installs keep
logs silent and clock verification disabled; enable `LOG_LEVEL=debug` for logs
and set `LIVE_TIMING_CLOCKS_VERIFIED=true` only after checking service clocks.

## Fresh Supabase project

Setup inspects the selected project through the Supabase Management API's
read-only SQL endpoint. A fresh project must have no application objects in
`public` and no existing migration history table. The preflight ignores the
zero-argument `public.rls_auto_enable()` helper when counting public objects,
as it can be present on an otherwise unused Supabase project. This exception
does not drop or modify the helper, permit other public objects, or bypass
the migration-history check. If the inspection fails or returns an unknown
format, setup stops before attempting schema changes.

For an empty project, setup stages only `setup/database-schema.sql` as
`00000000000000_coreza_initial_schema.sql` in a temporary workspace with the
project's generated Supabase configuration. It rechecks that the project is empty
before pushing that single bootstrap, then checks the database contract in
`setup/database-contract.sql`. The temporary workspace is removed afterward;
repository migration files are never deleted, regenerated or replayed.

`node_executions` is no longer created or required by setup; existing copies are
left in place. Per-node SQL history endpoints retain their empty response shape.

The bootstrap includes the active workflow tables and revision/save RPC,
hierarchy writer guard/readiness, run validation and partial schedule-key index,
shared Live/Backtest reporting, equity OHLC fields, selected-market preferences,
chat memory, RLS, explicit grants and Realtime publications. It creates none of the
retired snapshot, SQL-variable, legacy-reporting or billing tables/RPCs listed in
[the retirement audit](database-retirement-audit.md).

Supabase Edge Functions are not installed or deployed. The local Edge Runtime and
seed-file loading are disabled. Credential encryption stays in the backend using
`COREZA_ENCRYPTION_KEY`; setup does not upload it as a Supabase secret.

## Existing project or repeat installation

Setup checks the existing database against the same current contract and makes
no schema or migration-history changes. Compatible projects can proceed to
service startup. Missing tables, columns, functions, constraints, enabled triggers,
RLS, grants, the partial schedule-key index or Realtime membership stop setup with a list of missing requirements.
This catalog check does not exercise application behavior or prove owner isolation.

Upgrade existing projects explicitly before rerunning setup:

1. Inspect the actual schema and remote migration ledger for the selected project.
   Distinguish projects bootstrapped by the installer from projects with the
   historical timestamped migration lineage. A matching version alone does not
   prove that all current objects are present.
2. Select only the forward changes needed for that lineage. For an older installer
   bootstrap, account for workflow revision/save and hierarchy protection, OHLC,
   and selected-market updates. Never apply the full fresh bootstrap over an
   existing project or replay the repository's entire historical directory.
3. Stage the reviewed migration set and project configuration in a separate
   workspace. With CLI 3.0.0, use an explicit `--remote` target and preview with
   `db push --remote --dry-run` before applying selected migrations. Reconcile
   missing ledger entries manually only after confirming their schema effects;
   setup never marks versions reverted or retries failed DDL automatically.
4. Apply the retirement migrations separately after deployed consumers have
   moved off the retired objects. Historical data is intentionally discarded;
   no archive is required. Setup does not apply these migrations to existing
   projects automatically.
5. Rerun `node setup/setup.js` to check the current contract and finish setup.

Already-deployed legacy Edge Functions are not deleted by this installer. Their
source and deployment steps have been removed from the repository.

## Trades appear but Orders is empty after a fresh install

The Orders tab reads `live_fills`, while closed trades are written separately to
`trades`. Earlier fresh-install bootstraps created an unquoted `timeInForce`
column, which PostgreSQL folded to `timeinforce`. The fill worker sends the
case-sensitive `timeInForce` field, so those installs reject fill inserts even
while closed trades and equity snapshots continue to persist.

Inspect the actual column names in the selected project:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'live_fills'
  AND lower(column_name) = 'timeinforce';
```

If the result is only `timeinforce`, apply the reviewed forward migration
`supabase/migrations/20261106093056_fix_live_fills_time_in_force_case.sql` to that
project using the selected-migration upgrade procedure above. It renames the
column in place, preserves rows and access controls, and reloads the Data API
schema cache. It is a no-op when the correctly named column already exists;
ambiguous or missing columns stop the repair for manual inspection. Setup itself
does not apply this repair to existing projects.

Afterward, verify that a new fill reaches `live_fills` and the Orders tab.
Previously failed events may remain pending in the workflow's Redis fill stream;
the schema repair alone does not replay or reconstruct them. Keep those streams
intact and inspect pending events before attempting recovery. Enable
`LOG_LEVEL=debug` when diagnosing `LiveFillRepository` / `FillSyncWorker` errors.
