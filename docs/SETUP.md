# Installing and upgrading Coreza

Run `node setup/setup.js` from the repository root. The Windows launcher runs this
same installer before starting the services. Setup uses Supabase CLI **3.0.0**,
with an explicit remote target for database changes. Supply the project URL,
publishable and secret keys, personal access token, and database password when
prompted. Existing environment-file values are reused, including the backend
encryption key.

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
