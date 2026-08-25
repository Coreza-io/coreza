# Consolidator Scan — remaining work after the merge review

The external verdict is accurate. I re-verified every claim in the repo; the plan is mostly implemented, but one bug breaks a test and several delivery/runtime gaps remain.

## Confirmed already implemented

`isWarmingUp` on `ExecutionContextExtras`; benign late-bar suppression plus `failed`/`failedNodeErrors` reset in both runtimes; corrupt-state skip with `consolidatorInvalidStatesCounter`; `endTimestamp` validation in `isConsolidatorState`; per-symbol injection passes; commit-after-successful-delivery via `pendingCommit` + `commitConsolidatorEmissions`; mixed-join warn at `WorkflowPlan.compile`; manual endpoint `dryRun` default and all-emissions response; finite `endExclusiveClock` used verbatim; compiled backtest VM marks consolidator workflows ineligible; inner `scan()` emission reason preserved.

## Blocker — per-node grace is dropped in the executor

`ConsolidatorExecutor.execute` parses `scan_grace_ms` into `scanGraceMs` and passes it into `parameters`, but the `dataContext.setData(stateKey, result.state, { ... })` metadata object omits it. `scanConsolidators` reads grace from `ref.meta.scanGraceMs`, so a node-configured grace never applies and the bucket closes early. This is why the "honors a per-consolidator feed-latency grace" test currently fails (emits at `04:00:59.999`).

Fix: add `...(scanGraceMs === undefined ? {} : { scanGraceMs })` to that metadata object, then re-run `tests/timeBarConsolidatorScan.test.ts`.

## High 1 — `emissionId` is not a delivery receipt

`emissionId` only travels inside the payload; nothing persists or checks it. Delivery is at-least-once: if a downstream side effect succeeds and a later node (or the process) fails before commit, the next scan replays the same emission and repeats the external effect.

Fix:

- Persist a durable delivery record keyed by `emissionId` (Redis `SET NX` with a TTL well beyond the scan interval, in the same user/execution scope as the other consolidator keys).
- Skip candidates whose `emissionId` is already recorded as delivered, and commit the consolidator state for them so retries drain.
- Pass `emissionId` into the execution context as an idempotency key so order/notification executors can reuse the existing SHA256 idempotency path instead of inventing a second one.

## High 2 — batch by logical clock, not just symbol

`executeInjectedResults` groups by `emission.payload.symbol` only, so a 4h bucket ending 16:00 and an overdue daily bucket ending 00:00 for the same symbol are injected in one pass and can wrongly satisfy a join.

Fix:

- Group by `symbol + bar.endTimestamp`, iterating groups in ascending `endTimestamp` order (the scan already sorts deterministically).
- Merge every group's `nodeResults`/`executionOrder` into one aggregate `WorkflowExecutionResult` so the Redis run record is complete instead of holding only the last batch.
- Add a test: one symbol, two consolidator nodes with different target timeframes emitting on the same tick, asserting two separate downstream passes.

## High 3 — manual-session check is bypassable

`/storage/consolidator` resolves `executionId = runId ?? workflowSessionId ?? backtestId`, but classifies the session as manual from the mere presence of `workflowSessionId`/`backtestId`. A request carrying a live `runId` plus any `workflowSessionId` resolves the live context, is classified manual, skips the future-clock check, and can run `dryRun: false` against live state.

Fix:

- Require exactly one of `runId` / `workflowSessionId` / `backtestId`; reject with 400 otherwise.
- Derive the session type from the identifier actually used (`runId` ⇒ live), not from field presence.
- Keep the future-clock and mutating-scan rules bound to that derived type; add a test posting both `runId` and `workflowSessionId`.

## Medium 1 — configuration and UI contradict the code

- `coreza-backend/.env.example` still sets `CONSOLIDATOR_SCAN_GRACE_MS=2000` while the runner default is now 60s. Raise the example to 60000 with a comment that it must be set from measured feed latency.
- `src/nodes/Consolidator.json` exposes no `scan_grace_ms` field and still says "Input-driven only: … partial final bars are not flushed." Add the field (number, optional, ms, with help text) and rewrite the description to cover clock-driven emission when `ENABLE_CONSOLIDATOR_SCAN` is on.

## Medium 2 — scan timer ticks accumulate

`startConsolidatorScanTimer` enqueues a job onto `workChain` on every interval regardless of whether the previous scan finished, so slow downstream processing builds an unbounded backlog.

Fix: coalesce with a `scanPending`/`scanRunning` flag (skip the tick when a scan is already queued or running), or switch to a self-rescheduling `setTimeout` that arms the next scan only after the current one settles. Clear the handle in the existing stop path.

## Minor

Late-bar results return `{ emitted, bar, lateBarDropped }` only — no `symbol`, timeframes, `workingBar`, `emissionReason`, or `emittedAt`. Fill the remaining `ConsolidatorPayload` fields so downstream templates see a consistent shape.

## Sequence

1. Executor grace metadata (unblocks the failing test).
2. Manual-endpoint identifier hardening (High 3) + test.
3. Clock-aware batching and aggregated results (High 2) + test.
4. Scan-timer coalescing (Medium 2).
5. Durable `emissionId` receipts and idempotency-key plumbing (High 1) + replay test.
6. `.env.example`, `Consolidator.json` field/description, late-bar payload shape.

## Test note

`tests/consolidatorRoute.test.ts` and `tests/consolidatorScanRouting.test.ts` fail to compile in this sandbox from missing `ioredis`/`express` type declarations — an environment issue, not an implementation defect.
