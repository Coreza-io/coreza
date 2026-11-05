# Remove legacy cash snapshots

5 November 2026 · Implementation plan for `dev`

## Scope

Remove `public.cash_snapshots` and its remaining setup and application references. The fallback writer was already removed from `dev` in [cf05ae8](https://github.com/Coreza-io/coreza/commit/cf05ae8ac19a41a83ce4c0186403bb5a6052b2b9). Manual does not use the snapshot worker. Backtest persists and reads its equity history through `portfolio`. Live writes scoped snapshots through the worker and reads them through `portfolio`. Keep the shared reporting implementation and existing execution paths.

## Implementation

| Location | Change |
| --- | --- |
| `setup/database-schema.sql` | Remove the legacy table definition, RLS enablement, and policy statements for fresh installs. |
| `setup/validate.js` | Remove `cash_snapshots` from the required-table inventory. Keep `portfolio` and `live_fills` in the inventory. |
| `src/integrations/supabase/types.ts` | Remove the `cash_snapshots` table entry and its Row, Insert, Update, and Relationships types. |
| `coreza-backend/src/repositories/CashSnapshotRepository.ts` | Rename the file, class, logger, and row type to use `PortfolioSnapshot`. Keep the existing `portfolio` upsert, snapshot ID conflict target, and live metrics notification. |
| `coreza-backend/src/workers/FillSyncWorker.ts` | Update the import and call to the renamed repository. Preserve scope validation, retry handling, and Redis compare/delete after successful persistence. |
| `docs/shared-strategy-reporting.md` | Update the persistence notes to reflect the retired table and the location of preserved historical data. |
| `supabase/migrations/` | Add a new forward migration to drop only `public.cash_snapshots` with restrictive dependency handling. Keep the historical migrations intact. |

## Rollout

1. Deploy the application changes before applying the drop migration. `main` and `sit` still contained the old fallback at review time. Confirm that every worker and client sharing the target database has moved off the table, including deployed rollback versions and any external readers or scheduled jobs. Keep the migration out of automatic deployment until these checks pass.
2. Recount and archive the legacy rows with their IDs, timestamps, and full payloads. The connected project had 737 rows and none matched a live reporting header by owner, workflow, and execution ID. Keep the archive in restricted storage and verify it can be restored. Avoid attaching unmatched records to another activation.
3. Recheck dependencies and apply the forward migration without `CASCADE`. For a rollback to a version that requires the table, restore the table, its grants and policies, and the archived rows before deploying that version.

## Verification before release

- Search runtime code, setup, and types for remaining legacy references. References in historical migrations and retirement documentation are expected.
- Verify that fresh setup completes without creating the legacy table and that the existing-project migration removes only that table.
- Exercise Manual portfolio operations, Backtest equity history, and Live snapshot writes and reads. Confirm a repeated Live snapshot ID upserts the same row and a failed write leaves the Redis payload retryable.
