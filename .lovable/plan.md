# Consolidator Scan — review findings and remediation plan

The `scan()` core is correct (expiry close, `lastEmittedEndTimestamp`, `time_scan` reason, deterministic ordering, shared close path with `update()`). The wall-clock wiring around it is not production-ready. The external review is accurate — every claim below was re-verified in the repo.

## Blocker — TypeScript build failure

`ExecutionContextExtras` in `workflowRun.ts:32-35` has only `multiBarContext` and `runId`, but `BacktestSession.executeConsolidatorClock` calls `setExecutionContextExtras({ isWarmingUp })`. Under `strict` + `tsc` this is an excess-property error.

Fix: add `isWarmingUp?: boolean` to the interface. Do this first.

## High 1 — emitted bar can be permanently lost

`scanConsolidators()` commits the post-emit state (`workingBar` cleared, `lastEmittedEndTimestamp` set) before `createRunInRedis` and `executeInjectedResults`. A Redis failure, crash, or downstream failure loses the bar with no way to recreate it — at-most-once delivery.

Fix: split discovery from commit.
- `scanConsolidators(dataContext, time, { commit: false })` returns candidate emissions with a deterministic `emissionId` = `{executionId}:{nodeId}:{symbol}:{bucketEndTimestamp}`.
- Persist the new state only after the run record exists and injection succeeded.
- On failure, leave the working bar intact so the next tick retries; dedupe replays by `emissionId` (`lastEmittedEndTimestamp` already blocks double-emit once committed).

## High 2 — multi-symbol emissions collapse on one node

One node holds one state per symbol, so a scan can return two emissions with the same `nodeId`. `executeInjectedResults` injects both into the single `nodeId` result slot; the live runtime's `enqueuedKeys` also dedupes the downstream node, so one symbol is dropped and template resolution can read a different symbol than the routed payload. Existing routing test uses two distinct node IDs (`scan-a`/`scan-b`) and misses this.

Fix: group emissions by symbol and run one injected pass per `(symbol)` batch (each pass injects at most one emission per node), then extend the routing test with two symbols on one node ID.

## High 3 — scan cannot satisfy a mixed multi-parent join

`executeInjectedResults` calls `resetForNextBar(true)`, clearing `edgePayload` (live) and `satisfiedCounts` (backtest) plus prior results. A join fed by a consolidator *and* a normal bar branch never becomes satisfied on a scan run. The current test only joins two consolidators emitting in the same scan.

Fix: define the semantics explicitly rather than blindly preserving counters (which would route stale payloads):
- Cache the latest non-consolidator branch payload per edge and seed it for scan runs, gated by a max-age, or
- detect mixed joins at graph-build time and reject/warn that scan injection is unsupported for them.
Pick the seeding option only with an explicit staleness bound; otherwise ship the detection and warn.

## High 4 — timer can emit before the final source bar, and late bars poison the runtime

Defaults `INTERVAL_MS=1000` / `GRACE_MS=2000` close a 12:00–16:00 bucket at ~16:00:02; a 15:00 bar delivered at 16:00:03 is then rejected as `LATE_BAR_AFTER_EMIT` and the emitted OHLCV is permanently incomplete. Today the executor returns `success: false`, and `resetForNextBar` clears results/queue but **not** `failed`/`failedNodeErrors` — so one late bar leaves the long-lived runtime reporting failures on later events.

Fix:
- Return late bars as benign: `success: true`, `data: { emitted: false, bar: null, lateBarDropped: true }`, `control: { suppressDownstream: true }`, still incrementing `consolidatorLateBarRejectsCounter`.
- Clear `failed` and `failedNodeErrors` in `resetForNextBar`.
- Raise the default grace and make it configurable per source/timeframe; document that it must be set from measured feed latency, not the 2s guess.

## High 5 — manual scan endpoint mutates live state without routing

`POST /storage/consolidator` with `operation: "scan"` calls `scanConsolidators()` against the real `DataContext` and returns `emissions[0]?.payload`, mutating state without injecting downstream. A future `current_time` can force-close a live bucket, hide the bar in an HTTP response, and make subsequent real bars late.

Fix: default the endpoint to `dryRun` (no commit), require an explicit non-live/manual session for mutating scans, reject `current_time` beyond now for live sessions, and return all emissions rather than the first.

## Medium

1. **Final backtest scan overshoots.** `Math.max(requestedEnd, clockAfterFinalSourceBar)` can scan past the requested end-exclusive clock and emit a bucket that had not expired. When `endExclusiveClock` is finite, use it verbatim.
2. **One corrupt state starves everything.** `scanConsolidators` throws on the first invalid state, failing the whole tick. Log, increment a metric, and skip the damaged ref.
3. **`endTimestamp` is unvalidated.** `isConsolidatorState` only runs `parseBar(state.workingBar)`, which ignores `endTimestamp`; a missing/invalid value survives and NaN comparisons make the bucket emit immediately. Add `Number.isFinite(new Date(state.workingBar.endTimestamp).getTime())`.
4. **Compiled backtest plan bypassed.** `executeConsolidatorClock` always uses the interpreted `this.run`, which holds none of the compiled VM's node results. Either route injection through the compiled plan or fall back to engine mode (logged) when a consolidator is present.
5. **Emission reason mislabelled.** When `update()`'s inner `scan()` closes the bucket, the result is relabelled `boundary_input` with `emittedAt = input.timestamp`. Keep the inner reason.

## Sequence

1. Fix the build blocker (`isWarmingUp`).
2. Late-bar benign handling + failure-state reset (High 4) — smallest fix that stops runtime poisoning.
3. Validation and skip-on-corrupt hardening (Medium 2, 3).
4. Multi-symbol batching (High 2) + per-symbol routing tests.
5. Commit-after-delivery with `emissionId` (High 1).
6. Mixed-join semantics decision + implementation (High 3).
7. Manual endpoint hardening (High 5).
8. Final-scan clock and compiled-plan handling (Medium 1, 4), emission reason (Medium 5).

## Tests to add

- Two symbols on one consolidator node produce two downstream executions with distinct bars.
- Consolidator joined with a bar-driven branch: documented behaviour asserted (executes with seeded payload, or is rejected at build time).
- Injection failure leaves state uncommitted and the next scan re-emits exactly once.
- Late bar after `time_scan` returns success with suppression, increments the counter, and leaves the runtime unfailed on the next event.
- Working bar with a broken `endTimestamp` is rejected by `isConsolidatorState`.
- Final backtest scan does not exceed a finite `endExclusiveClock`.
- Manual scan endpoint defaults to dry run and rejects a future `current_time` for a live session.
