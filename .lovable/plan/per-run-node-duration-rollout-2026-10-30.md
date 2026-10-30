# Per-run node duration: implementation and rollout

Date: 2026-10-30

## Implemented

- Live WorkflowRunner clears the existing timing map after each event reset and
  before executing the new run. The persisted total/count/average now cover that
  event, including all repeated node invocations inside it.
- The history badge tooltip identifies the value as total node execution time
  within the run, including repeated invocations.
- The shared/backtest reset path is unchanged. Timing snapshots already copy
  numeric totals into new objects, so a later clear cannot modify earlier runs.
- No new clocks, metric families, logging, per-event network calls or schema
  changes were introduced. Broker executor and HTTP timings remain breakdowns
  with their own boundaries.

## Validation and rollout plan

1. Run TypeScript checks for backend and frontend and compare diagnostics against
   their existing baselines; inspect the diff. No automated tests added or run.
2. After deployment, restart the live workflow and compare several new run IDs:
   persisted timing totals must match history badges within display rounding.
3. Include alternating buy/close and order-update events. A node absent from an
   event must not carry timing from an earlier event. Confirm older run snapshots
   remain stable after more events complete.
4. Check repeated invocations inside one event: count and total must include all
   invocations. Compare TRADE_TIMING only with its executor boundary; expect a
   small difference from the engine's node measurement.

Manual broker/browser checks remain pending. Previously recorded cumulative
history cannot be reconstructed and is not rewritten. Whole-run duration and
node duration are distinct, and backtests retain their aggregate timing policy.
