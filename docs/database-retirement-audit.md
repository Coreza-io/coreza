# Unused database objects

Audited the current `dev` application and the connected Supabase project's public
catalog on 5 November 2026. This is a repository cleanup and an unapplied forward
migration, not a live database deletion.

## Retired objects

| Group | Tables | Evidence and replacement |
| --- | --- | --- |
| SQL variable persistence | `workflow_variables`, `workflow_variable_revisions`, `workflow_live_variable_state` | No application table or RPC callers remain. Editor variable scopes use `EditorVariableService` and Redis; activation markers use `ActivationRegistry`. |
| Legacy strategy reporting | `live_trades`, `backtest_results`, `backtest_trades`, `backtest_portfolio_snapshots` | No application callers remain. Current Live and Backtest reporting use `live_strategies`, `trades` and `portfolio`. Historical rows are not automatically copied or reassigned. |
| Legacy position history | `position_snapshots` | No application callers remain. Remove its fresh-setup definition, policies, validation requirement and generated type. |
| Billing/metering | `subscriptions`, `usage_metrics` | No application billing-table or metering-RPC callers remain. Market data subscriptions use separate Redis services. The signup trigger still creates billing rows, so the migration preserves profile creation while removing that insert. |

The migration removes every old variable RPC overload:
`workflow_variables_snapshot(uuid)` and `(uuid,uuid)`,
`workflow_variables_revision(uuid)` and `(uuid,uuid)`,
`mutate_workflow_variable(uuid,text,text,text,jsonb)`,
`commit_workflow_variables(uuid,uuid,text,text,jsonb)`,
`commit_workflow_variables_legacy(uuid,uuid,text,text,jsonb)`,
`workflow_live_variables(text,uuid,uuid,jsonb)` and
`validate_live_variable_checkpoint(text,text,uuid,uuid)`.

It also removes `check_execution_limit(uuid)`, `get_current_usage(uuid)`,
`increment_execution_count(uuid)`, `get_user_tier(uuid)`, the obsolete
`subscription_status` and `subscription_tier` enums, and the superseded
`validate_workflow_run_scope()` function if present. The current
`validate_workflow_run_contract()` trigger function remains.

The earlier cash snapshot migration and removal of the two unused Edge Function
source files are part of the same PR.

## Objects retained

Keep the application tables: `users`, `projects`, `workflows`, `workflow_versions`,
`workflow_runs`, `node_executions`, `user_credentials`, `backtests`, `live_fills`,
`coreza_chat_history`, `live_strategies`, `trades` and `portfolio`.

Keep workflow save/readiness RPCs and all current trigger functions, even when
there is no direct TypeScript caller. Signup, timestamp updates, workflow writer
protection, run validation, reporting scope checks, backtest lifecycle mirroring
and reporting metrics triggers are database callers. Keep all reporting RPCs.

Keep historical migration files and their historical migration tests. Removing
old files would not remove deployed objects and would break schema replay or
existing-project migration history. The fresh setup schema already excludes the
old billing, SQL-variable and reporting tables; position snapshots were its only
additional obsolete table definition.

## Installation

Fresh installs use only the current `setup/database-schema.sql` bootstrap staged
in a temporary directory. Setup does not replay historical migrations, recreate
retired objects, deploy Edge Functions or load an unused seed file. Existing
projects receive a read-only contract check; upgrades and retirement remain
explicit. See the [installation guide](SETUP.md).

## Catalog findings and rollout

Read-only catalog inspection found no incoming foreign keys from retained tables,
no dependent views, and no Realtime publication membership for these ten tables.
The SQL functions referring to them belong to the retired groups or the signup
function updated in this migration. The connected project has no `cron.job`
table. No current saved workflow node JSON mentions the retired table names.
These observations do not establish that other deployments or external clients
have stopped using them.

The connected project contained the following exact row counts at inspection:

| Table | Rows |
| --- | ---: |
| `workflow_variables` | 3 |
| `workflow_variable_revisions` | 1 |
| `workflow_live_variable_state` | 0 |
| `live_trades` | 130 |
| `backtest_results` | 57 |
| `backtest_trades` | 536 |
| `backtest_portfolio_snapshots` | 30,065 |
| `position_snapshots` | 0 |
| `subscriptions` | 2 |
| `usage_metrics` | 0 |

Deploy the current application to all workers and clients sharing the database
before applying `20261105121812_retire_unused_database_objects.sql`. Keep it out
of automatic deployment. Confirm external clients, SQL jobs and rollback versions
have moved off the retired objects. Historical rows and receipts are intentionally
discarded; no archive, data reconciliation or restore verification is required.
Do not import old reporting data into a different activation.

Recheck database dependencies immediately before applying. The migration runs
transactionally, rejects non-idle live-variable ownership, updates signup before
dropping billing, and uses explicit `RESTRICT` drops without `CASCADE`. It does not
stop live workers. Rollback versions must support the retired schema.

No tests, type checks, application execution or migration execution were performed.
Database access was limited to read-only catalog, row-count and reference audits.
