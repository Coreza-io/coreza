# Consolidator Scan Plan — implementation review

Verified end to end against the repo. The plan is essentially fully implemented, with one real defect (a failing test caused by a dropped field) and two small follow-ups.

## Implemented and confirmed

- **Blocker (build)** — `isWarmingUp?: boolean` is present on `ExecutionContextExtras` (`src/engine/workflowRun.ts:32-35`); `BacktestSession.executeConsolidatorClock` compiles.
- **High 1 (at-most-once loss)** — `scanConsolidators(..., { commit: false })` returns candidates carrying a deterministic `emissionId` and a `pendingCommit`; `commitConsolidatorEmissions` is invoked only from the delivery callback in both `WorkflowRunner.processConsolidatorScan` and `BacktestSession.executeConsolidatorClock`. Re-emit-until-committed is covered by a test.
- **High 2 (multi-symbol collapse)** — `executeInjectedResults` splits emissions into one pass per symbol and only reports delivered batches; routing tests cover two symbols on one node id and partial-batch commit.
- **High 3 (mixed join)** — the detection-and-warn option shipped in `WorkflowPlan.compile`, with a test.
- **High 4 (late bars)** — `ConsolidatorExecutor` converts `LATE_BAR_AFTER_EMIT` into `success: true` + `lateBarDropped` + `suppressDownstream` and increments the counter; both runtimes clear `failed`/`failedNodeErrors` in `resetForNextBar`; live scan grace default is now 60s with a comment to set it from measured feed latency.
- **High 5 (manual endpoint)** — `/storage/consolidator` scan defaults to `dryRun: true`, requires `current_time`, rejects future clocks for live sessions, requires a manual session to commit, and returns all emissions.
- **Medium 1/2/3/4** — final backtest scan uses a finite `endExclusiveClock` verbatim; invalid states are metered (`consolidatorInvalidStatesCounter`), logged and skipped; `isConsolidatorState` validates `endTimestamp`; the compiled backtest VM declares consolidator workflows ineligible so the interpreted path (which owns the injection) is used.
- **Medium 5** — `update()` propagates the inner `scan()` reason instead of relabelling.

## Defect to fix — per-node scan grace is never persisted

`ConsolidatorExecutor` computes `scanGraceMs` and puts it in `parameters`, but the `dataContext.setData(...)` metadata object omits it. `scanConsolidators` reads the grace from `ref.meta.scanGraceMs`, so a node-configured `scan_grace_ms` is silently ignored and buckets close early.

This is why `tests/timeBarConsolidatorScan.test.ts` → "honors a per-consolidator feed-latency grace" fails today (emission at `04:00:59.999` instead of `04:01:00.000`).

Fix: include `...(scanGraceMs === undefined ? {} : { scanGraceMs })` in the metadata written by `ConsolidatorExecutor.execute`, matching the `isMetadata` contract in `consolidatorScan.ts`.

## Minor follow-ups

1. **Late-bar payload shape.** The `lateBarDropped` result returns `{ emitted, bar, lateBarDropped }` only — no `symbol`/`sourceTimeframe`/`targetTimeframe`/`workingBar`/`emissionReason`/`emittedAt`, so it does not match `ConsolidatorPayload`. Fill the remaining fields (nulls plus the resolved symbol/timeframes) so downstream templates and the UI see a consistent shape.
2. **`boundary_input` is now unreachable.** Every emission is labelled `time_scan`, including bucket closes triggered by an arriving bar. That follows the plan's Medium 5 wording, but the union member and any UI text referencing it should either be dropped or the input-triggered close relabelled — pick one and make the type honest.

## Test note

`tests/consolidatorRoute.test.ts` and `tests/consolidatorScanRouting.test.ts` fail to compile in this sandbox from missing `ioredis`/`express` type declarations — an environment issue, not an implementation defect. `tests/timeBarConsolidator.test.ts` passes; `tests/timeBarConsolidatorScan.test.ts` passes except the grace test above.

## Sequence

1. Add `scanGraceMs` to the executor's state metadata; re-run `tests/timeBarConsolidatorScan.test.ts` (all green).
2. Normalise the late-bar payload to the full `ConsolidatorPayload` shape.
3. Decide and apply the `boundary_input` label decision.
