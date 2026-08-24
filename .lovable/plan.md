# Review: LEAN-style Scan for the Consolidator

## What is implemented correctly

- `TimeBarConsolidator.scan(currentTime, state)` closes an expired working bucket, records `lastEmittedEndTimestamp`, resets `sourceBarCount`, and tags `emissionReason: "time_scan"` with `emittedAt`. `update()` reuses `scan()` for the boundary transition, so both paths share one close rule.
- Late/duplicate/out-of-order guards run before aggregation; fill-forward volume is zeroed before accumulation.
- `scanConsolidators()` discovers states from `DataContext.listDataRefs()` via `kind: "consolidator_state"` metadata, validates each stored state, persists the post-emit state before returning, and sorts emissions deterministically by `endTimestamp → nodeId → symbol`.
- `executeInjectedResults()` exists on `WorkflowRun`/`WorkflowEngine` and injects results without re-running triggers; `injectResult()` honours `suppressDownstream`.
- Backtest sequencing calls `executeConsolidatorClock(event.timestamp)` before `SimBroker.onBar` in both bar loops, plus a final scan at `endExclusive` (line 1162).
- Live scans are timer-driven behind `ENABLE_CONSOLIDATOR_SCAN`, with grace and interval env knobs, serialized through `enqueueWork` (no overlap with stream messages), their own `runId`/Redis run record, metrics counters, and `clearInterval` on stop.
- Storage route `operation: "scan"` verifies the context's `userId` and `workflowId`, requires `current_time`, and scopes to one `nodeId`.
- Unit suites pass (`timeBarConsolidator`, `timeBarConsolidatorScan` — 12 tests). The other three suites fail only because `ioredis` is absent in this sandbox, not from code.

## Defects to fix

### 1. High — multi-symbol emissions collapse on one node
`scanConsolidators` can return several emissions for the same `nodeId` (one per symbol). `executeInjectedResults` injects them in a loop into the same node: `store.setNodeResult` overwrites, and the live runtime's `enqueuedKeys` dedupe means downstream runs once, with the last symbol only. Backtest runtime enqueues twice but reads a single overwritten result.
Fix: group emissions by node and run one injected pass per symbol (loop `executeInjectedResults` over symbol-grouped batches), so each symbol's bar routes downstream with its own result.

### 2. High — scan runs cannot satisfy multi-input joins
`executeInjectedResults` calls `resetForNextBar(true)`, clearing `edgePayload` (live) and `satisfiedCounts` (backtest). Any downstream node with more than one incoming edge never becomes satisfied on a scan-driven run, so a consolidator feeding an `If`/merge joined with a bar-driven branch silently does nothing.
Fix: preserve the previous bar's edge payload / satisfied counts for a scan pass (reset results only, not dependency state), or seed the non-consolidator edges from the last bar's results before injection.

### 3. High — compiled backtest plan is bypassed by the clock
`executeConsolidatorClock` always uses `this.run` (interpreted), even when `compiledPlan` is active. The compiled VM never writes into the interpreted store, so injected runs see no `BacktestInit`/upstream node results and behave differently from the bar path.
Fix: when `compiledPlan` is set, either route injected emissions through the compiled plan (an injection entry that seeds the consolidator slot and resumes downstream instructions) or disable the clock and fall back to engine mode when a consolidator is present, logging the downgrade.

### 4. Medium — late bar after a scan fails the whole run
With `CONSOLIDATOR_SCAN_GRACE_MS`, a source bar for a bucket already closed by the clock throws `LATE_BAR_AFTER_EMIT`; the executor returns `success: false`, marking the run failed.
Fix: treat `LATE_BAR_AFTER_EMIT` as a drop — increment the existing counter, return `success: true` with `suppressDownstream: true` and `emitted: false`, and keep hard failure only for `DUPLICATE_BAR_CONFLICT`/`OUT_OF_ORDER_BAR`.

### 5. Low — emission reason mislabelled on the boundary path
When `update()`'s internal `scan()` closes the bucket, the result is relabelled `boundary_input` with `emittedAt = input.timestamp`, discarding the fact that the close was expiry-driven. Keep the reason from the inner result and only override when the emission truly came from a new-bucket input.

### 6. Low — `scanConsolidators` throws on one bad state
An invalid stored state aborts the entire scan, so healthy consolidators are starved. Log and skip the offending ref (with a counter) instead of throwing.

## Test additions

- Two symbols on one consolidator node emit two downstream executions with distinct bars.
- Consolidator branch joined with a bar branch executes on a scan run.
- Compiled-plan session with a consolidator: clock emission reaches downstream, or the session provably fell back to engine mode.
- Late bar after `time_scan` returns success with suppression and increments the reject counter.
- `emissionReason` stays `time_scan` when `update()` closes an expired bucket.
