# Investigate: backtest_trades not populated on recent runs

Diagnosis is not confirmed yet, so step 1 is verification rather than a fix.

## Step 1 — Confirm where the trades are lost

For the most recent backtest run, check in order:
1. Did the run close any round trips at all? Inspect the SimBroker/portfolio trade ledger at finalize time (log closed-trade count next to the backtest id).
2. Did finalize run? Confirm `finalizeAll` / auto-finalize fired for that `backtestId` and that the run status reached `completed`.
3. Did the insert run and fail? Check the Supabase insert path for `backtest_trades` for a swallowed error (row count, returned error, RLS/grant rejection) instead of assuming success.
4. Compare identifiers: the rows are keyed by `backtest_id`, while state is now keyed by the canonical `executionId`. If finalize reads the ledger with `executionId` but writes with `backtestId` (or vice versa) after the recent execution-identity change, the ledger lookup returns empty and zero rows are inserted — this is the most likely regression given the recent identity refactor and must be confirmed before fixing.

## Step 2 — Fix per the finding

- Empty ledger from an ID mismatch: resolve the ledger with the same canonical `executionId` used at runtime, keeping `backtestId` only for the DB rows.
- Insert error swallowed: log and propagate it, and mark the backtest with an error message rather than completing silently.
- Finalize never invoked: ensure the completion path triggers it on the same code path as before.

## Step 3 — Guardrails

- Log a one-line summary at finalize: `backtestId`, `executionId`, closed-trade count, rows inserted — so a future mismatch is visible immediately.
- Add a regression test that a run producing N closed trades inserts N `backtest_trades` rows, exercising the ID resolution used by finalize.

## Technical details

Investigation touches `coreza-backend/src/backtest/BacktestExecutor.ts` (finalize + identity resolution), the SimBroker trade ledger, and the `backtest_trades` persistence helper. No frontend changes expected.
