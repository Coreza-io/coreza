# Consolidator Node — LEAN-style time-bar aggregation

Adds a stateful `Consolidator` node that turns lower-timeframe bars (e.g. 1h) into completed higher-timeframe bars (e.g. 4h), and only releases the workflow downstream when a target bar completes:

```text
OnBar 1h -> SimBroker.onBar (every source bar)
         -> Consolidator 4h -> (same bucket: hold) / (boundary: emit) -> RollingWindow / ATR / strategy
```

The attached design is sound and matches LEAN's `TradeBarConsolidator` on the essentials: left-closed/right-open buckets `[start, end)`, the boundary input closes the previous bar and opens the next (never double-counted), OHLC = first open / max high / min low / last close / summed volume, and no empty bars. It is adopted as-is with two deliberate LEAN gaps documented below.

## Where it differs from LEAN (accepted for v1)

- LEAN also has a time-driven `Scan` path that closes a bar at the wall clock even with no new input. V1 is input-driven only; a bar closes when the next source bar arrives. This is documented in the node description; a scheduled scan can be added later.
- LEAN can flush a final partial bar at end of data. V1 does not; the partial bucket is discarded on deactivation/finish.
- Calendar-month/quarter buckets are excluded (variable length). Minute/hour/day/week only.

## What gets built

1. **Shared timeframe utility** (`coreza-backend/src/utils/timeframe.ts`): parse/normalize `1m, 5m, 1h, 4h, 1d, 1w` to ms, validate that target is an exact multiple of source, expose the ratio. Reused by `HistoricalDataService` so there is one parser.
2. **Bar normalization** in `barParser.ts`: accept both the historical shape (`time|timestamp`, `open/high/low/close/volume`) and the live shape (`t`, `o/h/l/c/v`), with finite-value validation.
3. **Pure aggregation engine** (`engine/consolidation/TimeBarConsolidator.ts`): bucket alignment (UTC default, optional timezone + anchor via `date-fns-tz` so DST is handled), and the state machine — new bucket → create + hold; same bucket → merge + hold; newer bucket → emit previous + start new; exact duplicate → ignore; same timestamp with different values → duplicate-conflict error; older timestamp → `OUT_OF_ORDER_BAR` error.
4. **ConsolidatorExecutor** (`syncCapable = true`) registered in `nodes/index.ts` with `Consolidator: "Consolidator"` in `categoryMap.ts`. Working-bar state lives in `context.getState/setState` keyed by `symbol + source + target + timezone + anchor` (node id isolation already comes from the context), so it survives per-bar result resets and per-event `runId` changes in the live runner.
5. **Routing control flag**: add `suppressDownstream?: boolean` to the node control flags and honour it in both runtimes — the queue runtime (`engine/executionRuntime.ts`) returns after storing the result, and the compiled VM (`backtest/compiled/vm.ts`) continues without activating successors. A held bar is `success: true` with `emitted: false`, never an error.
6. **Node UI** (`src/nodes/Consolidator.json`): fields `candle_data` (required), `symbol` (required), `source_timeframe`, `target_timeframe`, optional `timezone` and `anchor_time`; output contract documenting `emitted`, `bar`, `workingBar`.
7. **Warm-up integration**: add `Consolidator` to the WarmupPolicy execute list; when a Consolidator sits upstream of stateful nodes, prefer `workflow_replay` mode, carry the partially built bucket across the warm-up→live transition, and keep trading/portfolio nodes rejected. Warm-up sizing becomes `downstream_required_bars * (target/source) + cushion`, taking `max(configured warmup_period, computed)`.
8. **Frontend serialization**: include Consolidator node values in the BacktestInit graph payload (`src/hooks/useNodeExecution.ts`) so the backend can read source/target timeframes for warm-up sizing — the same gap that previously dropped RollingWindow params.

## Verification

- Unit tests for `TimeBarConsolidator`: 1h→4h boundary emission, open/high/low/close/volume correctness, duplicate ignore, conflict and out-of-order errors, DST transition in `America/New_York`, and `09:30` anchor buckets.
- Runtime tests: a held result does not activate downstream nodes in the queue runtime nor the compiled VM; an emitted result does.
- End-to-end backtest run: SimBroker still receives every 1h bar while RollingWindow/ATR receive only 4h bars.

## Technical notes

Backend-only state machine plus one node JSON and one frontend serialization tweak. The only cross-cutting engine change is the `suppressDownstream` control flag, which is additive and defaults to today's behaviour for every existing node.
