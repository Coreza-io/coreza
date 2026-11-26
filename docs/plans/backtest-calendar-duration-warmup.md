# Calendar-day warm-up through OnBar

## Workflow contract

- Keep the existing `warmup_period` parameter as the only warm-up setting on Backtest Init. Label it **Warm-up (days)**. A value of `60` means the 60 calendar days immediately before Start Date. With Interval set to `1Hour`, Coreza emits the available one-hour candles from that window. Downstream 4-hour consolidation uses those same hourly candles.
- Use the same `OnBar` node, payload shape, and downstream graph for every candle. The existing `data.isWarmingUp` is `true` before the Start Date boundary and `false` from the boundary onward. The workflow author controls the branch with If, Switch, or other nodes. Coreza still rejects order mutations during warm-up, as LEAN does.
- Backtest Init prepares and registers the session. The normal batch runner or the editor's next OnBar step consumes the first candle. Warm-up candles appear in the normal bar output and, when per-bar execution history is enabled, in the same history list as strategy bars.

## 1. Use one field and make the unit change explicit

Update [BacktestInit.json](../../src/nodes/BacktestInit.json), the parser in [warmupPeriod.ts](../../coreza-backend/src/utils/warmupPeriod.ts), and the backtest init route, validation, and node metadata that consume it. Keep the existing key and expression support. After expression evaluation, accept a nonnegative whole number of calendar days and reject invalid values with a field error. An empty or omitted value defaults to `0`, which starts directly at Start Date. Replace the current implicit 200-bar default so missing settings cannot request 200 days of history.

Remove the Warm-Up Mode selector. Accept stale `warmup_mode` keys in saved workflows and stop using them for execution. Saved numeric values use calendar days after rollout, including explicitly saved values of `200`. Call out this behavior in the rollout notes and tell users to review saved values and expressions before rerunning. A bar count has no reliable conversion to calendar days across symbols, sessions, and data gaps.

Reuse the existing output summary fields for actual bar counts and first/last timestamps. Omit the now-inapplicable `warmup_bars_requested` after updating its consumers. Reuse the existing warning mechanism for insufficient history. The existing OnBar flag carries the phase, with no new configuration, payload, or result fields.

## 2. Load the fixed historical window

- In [BacktestExecutor.ts](../../coreza-backend/src/backtest/BacktestExecutor.ts), resolve a single effective Start Date boundary shared by warm-up and strategy. Follow [LEAN's duration calculation](https://github.com/QuantConnect/Lean/blob/master/Algorithm/QCAlgorithm.History.cs#L219-L223) by subtracting days in the effective algorithm timezone before converting to UTC. Use Coreza's existing backtest date semantics and align the LEAN comparison to that same timezone. Explicitly test New York for the reference equity fixture, including the DST change. Keep timezone out of the warm-up settings.
- Replace the backtest warm-up `fetchPreviousBars` call with [HistoricalDataService.fetchRange](../../coreza-backend/src/marketData/HistoricalDataService.ts). Use the strategy interval, symbols, provider, session coverage, feed, adjustments, credentials, and pagination. For Start Date `2021-05-01` and `60` days, the requested time window starts on `2021-03-02` in the effective timezone. The number of returned candles depends on market sessions and available history.
- Load warm-up and strategy data into one chronological event sequence using the existing alignment logic. Normalize provider timestamps, handle inclusive range endpoints, and deduplicate overlapped bars at the boundary. Use candle availability/end time for phase and prevent incomplete candles from being emitted before they are available. A candle delivered exactly at Start Date is a strategy event. Verify the boundary with providers that timestamp candle opens and providers that timestamp closes.
- Skip the pre-start fetch for zero days. Feed all available eligible candles in the fixed window for each symbol. Use indicator or consolidator minimums for diagnostics only. Preserve provider errors and report empty or short history without expanding the window or manufacturing candles. Document any differences in Coreza and LEAN session filters, fill-forward, consolidator anchoring, or corporate-action adjustments before claiming candle-for-candle parity.

## 3. Dispatch warm-up through the normal runner

[BacktestSession.initializeState](../../coreza-backend/src/backtest/session/BacktestSession.ts) currently executes a warm-up loop before marking the session ready. Remove that loop and the backtest-specific direct seeding of indicators and rolling windows. Initialization should set up the session, register instrument and indicator state, and leave the cursor at the first event. Keep shared seeding helpers used by other features.

- **Batch execution and explicit Run.** Route the prepared session to the normal batch runner. Today the batch branch in Backtest Init calls both `session.initialize()` and `session.runAll()` and returns owned strategy results with routing suppressed. Move the batch invocation to the normal backtest run orchestration after setup. Preserve strategy graph ownership, snapshots, cancellation, cleanup, results finalization, and single execution of downstream nodes when relocating that call. Both compiled and dynamic execution must consume the same sequence and set phase before dispatching each candle through OnBar.
- **Editor stepping.** The existing `/backtest/onbar` route calls `nextBar(true)`. Return the next candle through that route with the actual phase. Manual payloads currently hardcode `false`, and multi-symbol manual steps consume one symbol at a time. Keep all symbol steps at a timestamp in the same phase. Use the same phase for manual Trade calls issued after an OnBar response, including after the last warm-up candle. Move to the trading phase immediately before publishing the first strategy candle.
- **Boundary and reset.** Mark indicator warm-up complete once before the first strategy event. Preserve computed state, rolling windows, and any partially built consolidated candle. Preserve strategy bar counts, progress, and externally visible strategy indexes using separate internal event/strategy counters. Warm-up should generate no fills, equity snapshots, or performance samples. Reset clears per-run state and rewinds to the first event so warm-up is visible again. Cancellation, errors, and reset must clear session and broker phase consistently.
- **Execution history.** The existing history capture checks for phase `running`, which excludes warm-up. Capture both phases under the existing `BACKTEST_EXECUTION_HISTORY_ENABLED` setting. Keep the existing ordering, symbol and time filters, and node detail flow. Show the phase in bar details using the captured OnBar output and keep that output correct when node result objects are reused.

## 4. Let the graph decide what to run

Remove warm-up-only blanket skipping of ordinary workflow nodes from [WarmupPolicy.ts](../../coreza-backend/src/backtest/warmup/WarmupPolicy.ts) and its compiled and dynamic callers. Use the same backtest routing and executor semantics in both phases, including Store, If, Switch, Loop, Edit Fields, Consolidator, and indicators. Existing backtest executor restrictions still apply. Check the actual trading mutation entry points and simulated broker, including the manual trade route and alternative order paths, so a missing If cannot place, modify, cancel, or fill an order during warm-up. Read-only state and normal graph decisions can use the candle as usual.

For the reference strategy, place the If after the Consolidator, ATR, and pivot/trend/zone updates. Route to entry and exit evaluation only when the following expression is `false`.

```text
{{ $("OnBar").json.data.isWarmingUp }}
```

Update [OnBar.json](../../src/nodes/OnBar.json) and reconcile [the earlier OnBar status plan](onbar-warmup-status.md), which describes the previous manual-step and Direct Seed behavior.

## 5. Implementation and acceptance

1. Change the setting and historical window. Test `60` with `1Hour`, `0`, missing and invalid values, evaluated expressions, and saved settings. Cover pagination, empty data, a US holiday, DST, continuous crypto, multi-symbol alignment, timestamp boundaries, and overlapping provider responses.
2. Move dispatch into the shared sequence. Assert init executes zero strategy nodes. Verify batch compiled, batch dynamic, and manual sessions deliver the same chronological candles with the correct flag and exactly one transition. Cover a last warm-up manual symbol step, reset, cancellation, and the first strategy candle processed exactly once.
3. Verify Store and state updates during warm-up, If routing, no order mutations through any backtest entry point, no warm-up equity or result samples, and state carried into the first strategy event. With history enabled, click a warm-up bar and verify the captured OnBar output and downstream node details. Verify the existing disabled configuration still skips per-bar persistence.
4. Compare the hourly OTLK fixture (`2021-05-01` to `2022-01-01`, 60 days, 4-hour consolidator) against LEAN using matching timezone, sessions, fill-forward, and adjustments. Check source timestamps, consolidated candle boundaries, ATR, and pivot/trend/zone state at the transition. Use deterministic fixture data for automated tests and record provider or consolidator differences separately from the OnBar behavior.

[QuantConnect warm-up documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/historical-data/warm-up-periods)
