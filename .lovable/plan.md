# LEAN-Style Workflow Replay Warm-Up (v3)

## What the doc asks for

v2 (already shipped) fetches pre-start bars and *directly seeds* indicators + RollingWindows. v3 replaces that with LEAN's actual lifecycle: replay the pre-start bars **through the normal workflow** under an explicit warm-up phase, with trading and side effects blocked, then switch to the strategy range. Direct seeding stays as a compatibility mode behind `warmup_mode`.

The point: seeding only warms what `BacktestInit` knows how to seed. Replay warms *everything reachable* — custom node state, Compute accumulators, nested rolling windows — using the exact same code path as strategy bars, so warm-up behavior can never drift from run behavior.

## Verified current state

- `HistoricalDataService.fetchPreviousBars` already returns per-symbol pre-start bars; `BacktestExecutor` builds `warmupBarsBySymbol` and `strategyBars`, and passes both `rollingWindowSeed` and `indicatorWarmupSeed` into `BacktestSessionManager.createSession` (BacktestExecutor.ts:422-522).
- `BacktestSession` compiles a `WorkflowPlan`, optionally a compiled VM plan, then runs bars through `executeTimestamp`/`executeTimestampAsync` (lines ~450-580). Each timestamp: `SimBroker.onBar(envelope)` per symbol → per-symbol graph execution → `recordEquitySnapshot`.
- There is no phase flag anywhere: `CompiledExecContext` (compiled/types.ts) and the dynamic run context carry no `isWarmingUp`.
- `SimBroker.placeOrder` (simBroker/index.ts:206), `cancelOrder` (253), `liquidate` (584) are unguarded.

## Design

### 1. Phase contract — `src/backtest/warmup/types.ts` (new)

```ts
export type BacktestPhase = "initializing" | "warming_up" | "ready" | "running" | "finished";
export type WarmupMode = "seed" | "workflow_replay";
export type WarmupNodePolicy = "execute" | "suppress" | "reject";
export interface WarmupWarning { code: string; symbol?: string; requested?: number; available?: number; affectedNodes?: string[]; }
```

`isWarmingUp: boolean` is threaded into both execution contexts:
- Dynamic: a field on the run's execution-context extras (set alongside `multiBarContext` in `buildSymbolExecutionContext`), so every executor's `context.isWarmingUp` is populated.
- Compiled: a mutable field on `CompiledExecContext` (`ctx.isWarmingUp`), flipped by the session — not baked in at compile time, so one compiled plan serves both phases.

Single source of truth is `BacktestSession.phase`; both contexts read from it when the session flips phase.

### 2. Central policy — `src/backtest/warmup/WarmupPolicy.ts` (new)

One function `resolveWarmupPolicy(node): WarmupNodePolicy`, keyed on node category/name so compiled and dynamic modes cannot diverge:

| Category | Policy | Reason |
|---|---|---|
| Indicators, Data/RollingWindow, Compute, If/Switch/Loop, Edit Fields | execute | state building, pure |
| BacktestTrade, Portfolio mutations, Broker order ops | reject | would create trades |
| Telegram/Gmail/WhatsApp/Webhook/Notification | suppress | external noise |
| Storage writes, DocumentExtract downloads | suppress | side effects |
| AIAgent / LLM nodes | suppress | cost + non-determinism |

- **suppress** returns a deterministic success result (`{ success: true, data: null, warmupSuppressed: true }`) so routing/branching still works.
- **reject** returns a structured error `{ code: "ORDER_DURING_WARMUP" }`.

Enforcement point: the dynamic engine's node-execution wrapper and the compiled `ExecFn` adapter (`compiled/adapters.ts`) both consult the policy when `ctx.isWarmingUp` — a single shared helper called from two places.

### 3. Defense in depth — SimBroker

Add a `warmingUp` flag on `SimBroker` (set by the session on phase change). `placeOrder`, `cancelOrder`, `liquidate`, and any modify path return a rejected `OrderResult` with `ORDER_DURING_WARMUP` when set. This catches any executor path the policy table misses.

`onBar` is the one exception discussed below.

### 4. Warm-up events and replay — `src/backtest/warmup/WarmupReplay.ts` (new)

- `buildWarmupEvents(warmupBarsBySymbol, interval)` reuses the existing `alignMultiSymbolBars` logic to produce `MultiBarEvent[]` from the pre-start maps. Per-symbol counts are independent: a symbol with 62 bars simply contributes to fewer aligned events; the global aligned-event count is never used as a readiness measure.
- Events are retained on the session (`warmupEvents`) — this is the replay seed used by reset.
- `replay(session)` iterates events through the **same** `executeTimestampAsync` path with `phase = "warming_up"`, then flips to `ready`.

Market-state during warm-up: **do call** `SimBroker.onBar` for warm-up envelopes, but in a non-trading mode — orders can't exist (all order paths rejected), and `recordEquitySnapshot` is skipped. This keeps `SymbolMarketState` (used by `resolveMarketContext` and staleness policy) correctly primed for the first strategy bar instead of starting empty. Add a `SimBroker.onBar(envelope, { warmup: true })` overload that updates market state and skips pending-order processing and MTM equity recording.

### 5. Indicators during replay

Bulk `stateManager.warmUp(...)` must **not** run in replay mode — replaying the same bars afterwards double-counts them. Instead:

- `BacktestInit` calls a new `stateManager.initialize(key, type, params)` that creates empty state + updater without consuming bars.
- Each replayed event drives the existing `IndicatorsExecutor` incremental update path.
- `IndicatorState` gains `isReady` distinct from `warmupCompleted`, so short history reports "not ready" rather than a silent wrong value.

### 6. RollingWindow during replay

No changes to the class or its DataContext key. `seedRollingWindows` is **not** called in replay mode. The reachable `set` nodes create and fill the window during replay; the same instance carries into strategy execution. Same-size validation stays. A `set` node not on the executed path simply isn't warmed — that matches workflow reachability semantics, and `get` nodes read whatever a reachable `set` produced.

### 7. Metrics isolation

During `warming_up`: no equity snapshots, no trade/fill records, no `barsProcessed` increment, no progress reporting, no finalize check. Warm-up timings and event counts go into a separate `perf.warmup` block. `currentIndex` starts at 0 for strategy event zero, so manual stepping begins at the first strategy bar.

### 8. Session lifecycle

`BacktestSessionManager.createSession` becomes two-stage:

```
createSession(...)            // constructs, compiles plan
await session.initialize()    // phase=warming_up → replay → phase=ready
```

`BacktestExecutor.executeBacktestInit` awaits `initialize()` before returning, so `BacktestInit`'s output reflects post-warm-up state.

### 9. Deterministic reset

`BacktestSession.reset()` in replay mode, in this exact order:

1. Reject reset while `stepping`/running is active (or abort and await).
2. Reset SimBroker + strategy counters.
3. Destroy the old `WorkflowRun` (destroys its `DataContext`).
4. Clear execution-scoped indicator state: L1 cache, dirty keys, updater cache, **and Redis** (new `IndicatorStateManager.clearExecutionScope(userId, workflowId, executionId)` — today only `clearL1Cache()` runs, so Redis state survives a reset).
5. Recreate `WorkflowRun` + `DataContext` under the same execution identity.
6. Initialize empty indicator states.
7. Replay the retained `warmupEvents` with `isWarmingUp = true`.
8. Flip SimBroker + runtime to ready.
9. Re-pin `BacktestInit` results, rebuild the compiled plan.
10. `currentIndex = 0`, report ready.

In seed mode, the existing `seedRollingWindows` + rewarm path is kept unchanged.

### 10. Mode switch

`warmup_mode: "seed" | "workflow_replay"` on `BacktestInit.json` (default `seed` initially). The two modes are **mutually exclusive per session** — a guard throws if both direct seeding and replay would run, which is the main double-warm risk. Flip the default to `workflow_replay` after comparison runs match; retire `rollingWindowSeed.ts` and the bulk warm-up path afterwards.

## Where I'd deviate from the doc

1. **`SimBroker.onBar` during warm-up: the doc says don't; I say do, in a market-state-only mode.** Since the cross-symbol liquidation work, `SimBroker` owns `SymbolMarketState` and enforces staleness/causality via `resolveMarketContext`. Skipping warm-up bars entirely means the first strategy bar sees empty or stale market state — and any `get_position`/MTM read on bar zero behaves differently than it would mid-run. Feeding envelopes through a `warmup: true` path (no fill attempts, no equity snapshots) is both safer and closer to LEAN, where warm-up updates securities' prices.
2. **`TradingCalendarService` is deferred.** The doc lists it as a new file, but `fetchPreviousBars` already achieves count-correctness by filtering actual returned bars and expanding the window on shortfall. A calendar service would only reduce the number of fetch attempts. Ship it as a later optimization, not a correctness dependency.
3. **Suppress by default for unknown categories.** The doc's table enumerates known categories; for anything unmatched I'd default to `suppress` rather than `execute`. A new node type added later is far more likely to be a side-effecting integration than a state accumulator, and a suppressed node degrades gracefully while an unexpectedly executed webhook does not. State-building categories are explicitly allow-listed.
4. **Replay uses the async path only.** `executeTimestamp` (the sync/fire-and-forget variant) doesn't await node completion, which makes warm-up ordering non-deterministic. Replay always goes through `executeTimestampAsync` even when the compiled plan is active; the strategy loop keeps its current behavior.
5. **Warm-up is per session, not per reset seed set.** Retaining the aligned `warmupEvents` array replaces `RollingWindowSeed` + `IndicatorWarmupSeed` in replay mode — one seed instead of a growing family of component-specific seeds.

## Rollout

1. **Phase flags + policy + order guards** — `BacktestPhase`, `isWarmingUp` in both contexts, `WarmupPolicy`, SimBroker rejection. Tests prove every order path is blocked.
2. **Replay** — `buildWarmupEvents`, `session.initialize()`, empty indicator init, no seeding in replay mode, metrics isolation.
3. **Reset** — execution-scoped Redis clear, replay-on-reset, first-strategy-state snapshot comparison.
4. **Migration** — `warmup_mode` field, comparison runs, default flip, remove seed path.

## Acceptance tests

- `start_date` unchanged in DB; every strategy-range bar emitted.
- Every warm-up bar is strictly pre-start; `isWarmingUp` true for all replayed events, false before strategy event zero.
- Indicators and reachable RollingWindow `set` nodes process each warm-up bar exactly once (never twice — the seed/replay exclusivity guard).
- RollingWindow `isReady` on the first strategy bar when history suffices.
- place/close/liquidate/modify/cancel all rejected during warm-up; suppressed nodes return routable results.
- No equity snapshots, trades, or `barsProcessed` increments from warm-up.
- Reset reproduces a byte-identical first-strategy-bar state snapshot.
- `warmup_period = 0` → no replay, starts at strategy event zero.
- Compiled and dynamic modes produce identical warmed state and policy outcomes.
- Multi-symbol: a 62-bar symbol does not cap a 136-bar symbol.
