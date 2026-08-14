# Review: LEAN-Style Workflow Replay Warm-Up (v3)

Verified end to end against the code. The implementation is faithful to the plan — phase flags, policy gate on both execution paths, SimBroker guards, replay, metrics isolation, deterministic reset and mode exclusivity are all present. Two compile errors and three behavioral gaps need fixing.

## What is correctly implemented (verified)

| Plan item | Status |
|---|---|
| `BacktestPhase`, `WarmupMode`, `WarmupNodePolicy`, `WarmupWarning` | `backtest/warmup/types.ts` — matches |
| `isWarmingUp` in dynamic context | `engine/types/executionContext.ts:33`, defaulted false in `executionRuntime.ts:154`, set per bar from `phase === "warming_up"` (`BacktestSession.ts:313`) |
| `isWarmingUp` in compiled context | `compiled/types.ts:138`, compiled default false, flipped per bar at `BacktestSession.ts:586,663` — mutable, not baked at compile time as required |
| Single policy consulted by both engines | `enforceWarmupPolicy` called in `executionRuntime.ts:260` and `compiled/adapters.ts:29` |
| Suppress returns routable success | `{ success: true, data: null, warmupSuppressed: true }` |
| Reject returns `ORDER_DURING_WARMUP` | yes |
| SimBroker defense in depth | `warmingUp` flag (`simBroker/index.ts:94`), guards on `placeOrder` (208), cancel/modify paths (256-271), `liquidate` (602), `setWarmingUp` (687) |
| `onBar` market-state-only warm-up mode | `onBar(envelope, { warmup: true })` — ingests market state then returns before fill processing (index.ts:543) |
| `buildWarmupEvents` reusing alignment | `warmup/WarmupReplay.ts:69` |
| Replay via async path only | `initialize()` loops `executeTimestampAsync` |
| Empty indicator init, no bulk warm-up in replay | `initializeIndicatorStates()` → `stateManager.initialize(...)`; `completeIndicatorWarmup()` after replay |
| No equity snapshots / bars counted during warm-up | early `return` when `phase === "warming_up"` at lines 614 and 690 |
| Seed vs replay mutual exclusivity | throws in `initialize()`; executor gates `rollingWindowSeed` (BacktestExecutor.ts:501) and the indicator seed at the `createSession` call site |
| Deterministic reset | rejects while stepping/running, resets SimBroker, destroys run, `clearExecutionScope` (Redis-inclusive), recreates run, re-pins, recompiles, `phase = "initializing"` → `initialize()` |
| `warmup_mode` field, default `seed` | `src/nodes/BacktestInit.json:374-385` |
| Frontend RollingWindow serialization fix | `src/hooks/useNodeExecution.ts:286-291` |

## Must fix

### 1. Compile error — `perf` reset drops `warmup` (BacktestSession.ts:851)
`runAll` reassigns `this.perf` with an object literal that omits the new `warmup` block, so the type no longer satisfies the field and warm-up timings are wiped on run start. Add `warmup: { events: 0, totalMs: 0 }` to that literal (keeping accumulated values is not required — warm-up already finished by then, but the field must exist).

### 2. Compile error — `_sourceTimestamp` on generic `T` (WarmupReplay.ts:51)
`previous._sourceTimestamp` is read off a bare `T extends HistoricalBar`. Constrain the generic to `T & { _sourceTimestamp?: number }` (or read through a locally typed alias) so the fill-forward branch typechecks.

### 3. Warm-up perf snapshot restore also discards real work
`initialize()` snapshots `this.perf` before replay and `Object.assign`s it back in `finally`. That is correct for isolation, but it restores `mode` and `totalStart` captured before compilation state may change. Take the snapshot after `tryCompilePlan`, or restore only the accumulator fields explicitly — safer than a whole-object assign.

## Should fix

### 4. Policy substring matching is too eager
`REJECT_TERMS` / `SUPPRESS_TERMS` are matched with `identity.includes(term)`, where identity is `"<category> <nodeName>"`. Any user-renamed node containing `order`, `trade`, `broker`, or `store` is silently rejected or suppressed — e.g. a Compute node named "CheckOrderCount" gets `ORDER_DURING_WARMUP`. Match on the resolved category and the node's *definition* name (`node.name` from the JSON definition, not the user label), and drop substring matching in favor of exact set membership plus a small explicit prefix list.

### 5. `DataSource` executes during warm-up
`EXECUTE_CATEGORIES` includes `datasource`, so FinnHub/YahooFinance nodes fire real HTTP fetches for every replayed bar. Warm-up replays 200 bars: that is 200x the external calls, plus non-determinism. Move `datasource` out of the execute allow-list (suppress it), keeping only `indicators`, `controlflow` and the explicit node allow-list.

### 6. Untested surface
`tests/backtestWarmup.test.ts` and `backtestRollingWindowWarmup.test.ts` cover the seed path. No test covers the replay path. Add: order rejection during warm-up on every guarded method; suppressed node returns routable success; indicators consume each warm-up bar exactly once; reset reproduces an identical first-strategy-bar snapshot; `warmup_period = 0` skips replay; compiled and dynamic modes agree.

## Not blocking

- `TradingCalendarService` remains deferred, as agreed.
- Default is still `seed`; flip to `workflow_replay` after comparison runs, then retire `rollingWindowSeed.ts` and the bulk warm-up branch in `reset()`.
