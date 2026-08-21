# LEAN-style Scan for the Consolidator node

Today a bucket only closes when an input from a later bucket arrives, so a missing boundary bar delays or loses the bar. Scan closes an expired bucket on the clock without fabricating data. The plan below follows the attached document's sequence.

## Phase 0 — prerequisites (from the earlier review)

- Node-scoped state key `consolidator:{nodeId}:{symbol}:{source}:{target}:{timezone}:{anchor}`, required everywhere (executor, route, warm-up).
- `/storage/consolidator` verifies the `DataContext` belongs to the requesting user and workflow before reading state.
- `InMemoryStore.set()` subtracts an existing entry's size before the capacity check.

## Phase 1 — state and output contract

- `ConsolidatorState`: `workingBar?`, `lastInput?`, `lastEmittedEndTimestamp?`, `sourceBarCount`.
- `ConsolidatorPayload`: adds `emissionReason` (`boundary_input` | `time_scan`), `emittedAt`, `symbol`, `sourceTimeframe`, `targetTimeframe`; `workingBar` becomes nullable. `data.bar` stays the downstream contract.

## Phase 2 — pure `scan()` and unified close rule

- `scan(currentTime, previous)` in `TimeBarConsolidator`: no working bar ⇒ no output; not expired ⇒ unchanged; expired ⇒ emit the working bar once, clear it, record `lastEmittedEndTimestamp`, reset `sourceBarCount`.
- `update()` applies the same expiry transition using the input timestamp so the two paths cannot drift; boundary emissions report `boundary_input`.
- New `LATE_BAR_AFTER_EMIT` error when an input predates the emission watermark.

## Phase 3 — discovery

- The executor stores registry metadata with the state (`kind: 'consolidator_state'`, node id, symbol, normalized timeframes, timezone, anchor).
- `scanConsolidators(dataContext, scanTime)` finds due states, runs scan, writes state back, returns only real emissions.

## Phase 4 — runtime injection

- `WorkflowRun.executeInjectedResults(emissions)`: reset per-event results once per batch (never the persistent consolidator state), store each result under its real node id, route through that node's real outgoing edges, inject all same-clock emissions before draining the queue, apply the normal dependency/suppression/warm-up/cancellation rules, and never re-run the executor or upstream triggers.
- Touches `executionRuntime.ts`, `workflowRun.ts`, `workflowEngine.ts`.

## Phase 5 — backtest clock

Per source timestamp T, in order: `scanConsolidators(T)` → inject and execute emissions → `SimBroker.onBar(T)` → normal source-bar workflow → equity snapshot. Same ordering during warm-up replay (broker mutation still blocked). Before finalization, scan to the end-exclusive clock and emit only expired buckets — never a blanket flush. Scan once per timestamp, ordering simultaneous emissions by end time, node id, symbol.

## Phase 6 — live scheduling (feature-flagged)

- `WorkflowRunner` starts a configurable interval (default 1s) after consumer-group setup and scans at wall clock minus a configurable grace (default 2s).
- Timer ticks and `processMessage()` both enqueue onto one serialized promise chain so a read-modify-write cannot interleave.
- Emissions get a run id tagged `source=consolidator_scan`; ticks with no emissions create no run record. Metrics: scans, emissions, late-bar rejects, scan latency, downstream failures. `stop()` clears the timer and waits for in-flight work.

## Phase 7 — compiled VM and manual debug

- Scan-enabled consolidator plans are ineligible for compiled execution until parity lands. Then `runInjectedResults(plan, emissions)` writes result slots, activates only real downstream instructions, and enforces incoming dependency masks/counts (the any-of activation fix), verified by dynamic-vs-compiled parity.
- Manual `operation: "scan"` on the authenticated storage route (node id, workflow session id, current time) with ownership checks; production paths call the internal service, not HTTP.

## Verification

New tests: `timeBarConsolidatorScan`, `consolidatorScanRouting`, `workflowRunnerConsolidatorScan`, `backtestConsolidatorClock`, `compiledConsolidatorScan` — covering exactly-once emission, repeat scan, late input rejection, DST/anchor boundaries, multi-parent joins, serialized timer vs market event, scan-before-`onBar` fill ordering, expired vs unexpired final bucket, and unchanged continuous input-driven behaviour.

Flags: `ENABLE_CONSOLIDATOR_SCAN=false` by default, with configurable scan interval and grace.
