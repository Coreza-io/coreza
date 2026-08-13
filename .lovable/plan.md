# LEAN-Compatible Pre-Start Warm-Up for Backtests

## Goal

Today `BacktestInit` fetches one range (`start_date` → `end_date`) and then eats the first `warmup_period` bars of it for indicator/rolling-window warm-up (`BacktestExecutor.ts:409-422`: `symbolBars.slice(0, warmupPeriod)` / `.slice(warmupPeriod)`). So a backtest configured from 2014-01-01 actually starts trading ~136 bars later, and the strategy never sees the first part of the selected range.

Target: keep `start_date`/`end_date` authoritative, fetch a **separate** block of N bars strictly *before* `start_date`, warm state from that block, and emit **every** bar in the configured range to the strategy.

## Verified current state

- `BacktestExecutor.executeBacktestInit` computes one `effectiveRunId` and uses it for indicator keys, rolling-window seeding, and session creation.
- `discoverWarmupNodes` finds indicators and `RollingWindow` nodes downstream of BacktestInit.
- `backtest/rollingWindowSeed.ts` exists (`resolveRollingWindowSeedSize`, `seedRollingWindows`) and its `RollingWindowSeed` is retained on the session and re-applied in `BacktestSession.reset()` (line ~871).
- `reset()` calls `this.stateManager?.clearL1Cache()` only — Redis-resident indicator state is not deleted.
- `fetchHistoricalBarsForSymbols` (line 604) builds one `get_candle` broker call per symbol with `start`/`end` and `limit: "50000"`; there is no previous-N-bars capability and no canonical historical service.
- `warmup_period` is read in `BacktestExecutor` (`|| 200`, so `0` silently becomes 200), in `InitializeIndicatorsExecutor`, and forwarded by `routes/backtest.ts`.

## Scope decisions

- RollingWindow keeps its current class + `DataContext` storage and the existing same-size validation. Only its warm-up **input** changes to pre-start bars.
- Indicators keep `IndicatorStateManager.warmUp/update` and the existing key scheme.
- Warm-up never replays the workflow graph — only discovered stateful targets are seeded.
- Request key stays `warmup_period` for backward compatibility; only label/description and semantics change.

## Changes

### 1. New `coreza-backend/src/marketData/HistoricalDataService.ts`

Canonical service so provider range logic leaves `BacktestExecutor`:

```ts
fetchRange(req: HistoricalRangeRequest, ctx): Promise<Bar[]>
fetchPreviousBars(req: PreviousBarsRequest, ctx): Promise<Bar[]>   // count bars strictly before endExclusive
```

- `fetchRange` wraps the existing `BrokerExecutor` `get_candle` call (same node-shaping code moved out of `BacktestExecutor.fetchHistoricalBarsForSymbols`), so broker behavior is unchanged initially.
- `normalizeHistoricalBars`: dedupe by timestamp into a `Map`, drop non-finite times, sort ascending. Timestamp read as `bar.time ?? bar.t`.
- `fetchPreviousBars`: estimate a start date, fetch, filter `bar.time < startBoundary`, and if fewer than `count`, expand backward and retry up to `MAX_ATTEMPTS` (4). Return `eligible.slice(-count)`. Estimates: crypto `count × interval + margin`; daily `ceil(count × 1.6) + 10` days; intraday from session-count estimate. The estimate is an optimization — correctness comes from filtering real returned bars.
- Failure policy: return fewer bars with a warning rather than fabricating; never invent bars; errors include provider, symbol, interval, requested range, attempt.

Pagination/limits stay with the existing broker adapters for this pass; the service just re-requests with an expanded window when short. A follow-up can push Alpaca `next_page_token` / Binance kline paging into the adapters (documented, not required for correctness here).

### 2. `coreza-backend/src/backtest/BacktestExecutor.ts`

- Parse warm-up correctly: `const raw = params.warmup_period; const warmupBars = raw === undefined || raw === null || raw === "" ? 200 : Math.max(0, parseInt(String(raw), 10) || 0);` — `0` disables warm-up instead of becoming 200.
- Two datasets, both per symbol:
  - `strategyBarsBySymbol` = `HistoricalDataService.fetchRange({ start: start_date, end: end_date })` (unchanged range).
  - `warmupBarsBySymbol` = `fetchPreviousBars({ count: warmupBars, endExclusive: start_date })`, fetched **independently per symbol** — the primary symbol's availability must not cap the others.
- Delete `slice(0, warmupPeriod)` / `slice(warmupPeriod)` and `remainingBarsBySymbol`. `alignMultiSymbolBars` receives `strategyBarsBySymbol` only, so the first event timestamp is on/after the configured start and fill-forward can never source a warm-up bar.
- Indicator warm-up loop and `seedRollingWindows(...)` consume `warmupBarsBySymbol` (same call shapes, new input). `RollingWindowSeed` handed to `BacktestSessionManager.createSession` carries the pre-start map.
- Validation: empty strategy data for the **primary** symbol → error; empty for a secondary symbol → warning; short warm-up history → warning.
- Output additions on success: `warmup_source: "pre_start"`, `warmup_bars_requested`, `warmup_bars_by_symbol`, `first_warmup_timestamp` / `last_warmup_timestamp`, `first_strategy_timestamp`, plus the existing `rolling_windows_initialized`, and a `warnings[]` array of `{ code: "INSUFFICIENT_WARMUP_HISTORY", symbol, requested, available, affectedNodes }`.

### 3. `coreza-backend/src/backtest/session/BacktestSession.ts` — deterministic reset

Reset must reproduce exactly the post-init, pre-first-bar state. Required order:

1. Recreate the run / `DataContext`.
2. Delete execution-scoped indicator state in Redis (new `IndicatorStateManager.clearExecutionScope(userId, workflowId, effectiveRunId)`), not just `clearL1Cache()`.
3. Re-warm indicators from the retained pre-start seed (session must retain `warmupBarsBySymbol` + discovered indicator list alongside the existing `RollingWindowSeed`).
4. `seedRollingWindows(...)` from the retained seed (existing behavior).

### 4. `coreza-backend/src/engine/indicatorStateManager.ts`

- Add `clearExecutionScope(...)` deleting the Redis keys under the execution prefix.
- Normalize timestamp access to `bar.time ?? bar.t` in `warmUp`, `update`, `updateSync`.
- Distinguish `warmupCompleted` (loop ran) from `isReady` (enough history for the indicator's period) and surface the latter in the init output.

### 5. `coreza-backend/src/nodes/executors/InitializeIndicatorsExecutor.ts`

Same zero-vs-absent parsing for `warmup_period`. Discovery is unchanged.

### 6. Frontend

- `src/nodes/BacktestInit.json`: keep key `warmup_period`; label → "Warm-up Bars"; description → "Historical observations fetched before the configured start date to initialize indicators and RollingWindows. These bars are not traded. 0 disables warm-up."
- `src/hooks/useNodeExecution.ts`: when serializing the graph for `BacktestInit` / `InitializeIndicators`, values are currently attached only for `category === "Indicators"`, so `RollingWindow` (category `Data`) nodes arrive with `params: {}` — which is why the `operation === "set"` filter and size resolution misbehave. Widen the condition to also include `nodeDefinition?.name === "RollingWindow"`.

### 7. Tests

- `fetchPreviousBars`: returns exactly N bars, all strictly before the boundary, deduped and ascending; expands when the first attempt is short; returns fewer + warning when history is genuinely short.
- BacktestInit: strategy bar count equals the full configured range (no leading slice); first event ≥ start boundary; `warmup_period: 0` disables warm-up.
- Multi-symbol: a short-history symbol does not reduce another symbol's warm-up.
- Reset: indicator + window state after reset is byte-identical to post-init state.

## Sequence

1. `HistoricalDataService` + normalization + `fetchPreviousBars`.
2. `BacktestExecutor` two-dataset wiring, remove slicing, zero handling.
3. Reset safety (Redis scope clear + rewarm).
4. UI wording, `useNodeExecution` params fix, warnings/observability, tests.
