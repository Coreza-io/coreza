# Fix Alpaca regular-session partial candles in BacktestInit and OnBar

## Problem and evidence

With SPY, 1Hour, SIP, adjustment=all, Include Extended Hours=false, and 60 calendar days of warm-up, Coreza replay on 2021-07-02 begins at 15:00 UTC (11:00 America/New_York), not 14:00 UTC (10:00). It emits six full hourly bars instead of six full bars plus the opening 30-minute bar. QuantConnect's observed hourly clock includes the opening partial interval. The missing interval can change 4h OHLCV, ATR, rolling-window pivots, BOS and trades. Whether it explains the specific June 30 low mismatch must be verified against underlying data.

## Confirmed code path (dev)

- `coreza-backend/src/backtest/BacktestExecutor.ts`: passes include_extended_hours into HistoricalDataService for warm-up and strategy; candleEnd prefers explicit closeTime, otherwise adds the nominal interval; aligns replay by availability time.
- `coreza-backend/src/marketData/HistoricalDataService.ts`: forwards include_extended_hours to broker get_candle.
- `coreza-backend/src/brokers/alpaca/http/operations.ts`: get_candle finalizeResult invokes filterAlpacaRegularHours when the flag is false.
- `coreza-backend/src/brokers/alpaca/helpers.ts`: current predicate requires time >= session.open AND time + intervalMs <= session.close. The 09:00–10:00 hourly bar fails because session.open is 09:30.
- `coreza-backend/src/backtest/warmup/WarmupReplay.ts` and `session/BacktestSession.ts`: align and replay the surviving bars. OnBar forwards them; it does not independently filter.
- `coreza-backend/src/engine/consolidation/TimeBarConsolidator.ts`: bucket selection uses source start; completion currently uses start + nominal source duration. Partial bars require explicit end propagation.

## Target behaviour

Regular-hours only, exchange calendar and timezone, existing hourly grid:
| NY interval | UTC start (July 2, 2021) | UTC availability |
| --- | --- | --- |
| 09:30–10:00 | 13:30 | 14:00 |
| 10:00–11:00 | 14:00 | 15:00 |
| 11:00–12:00 | 15:00 | 16:00 |
| 12:00–13:00 | 16:00 | 17:00 |
| 13:00–14:00 | 17:00 | 18:00 |
| 14:00–15:00 | 18:00 | 19:00 |
| 15:00–16:00 | 19:00 | 20:00 |

No premarket/postmarket OHLCV. Keep native fully contained hourly bars; reconstruct only boundary partials. Do not shift the whole day to 09:30-anchored hourly buckets. No new UI fields.

## Implementation

1. **Calendar and bucket classification** — In Alpaca historical get_candle path, classify each requested intraday grid interval against the actual session from the Alpaca calendar. Fully contained: retain native candle. Non-overlapping: discard. Partial overlap: reconstruct from the intersection [max(bucketStart, open), min(bucketEnd, close)). Enumerate boundary intervals from the calendar and requested range even when no native boundary bar is returned, rather than relying solely on the returned hourly rows. Respect holidays, DST, early closes, request bounds and pagination semantics; avoid duplicate work across warm-up/strategy overlap.
2. **Fetch partial data** — Use existing Alpaca authenticated request/pagination infrastructure to fetch 1Min bars only for relevant partial windows, preserving symbol, SIP/IEX feed, adjustment, currency and cancellation. Avoid recursive finalizeResult filtering. Batch bounded requests when practical, deduplicate minute timestamps and filter minute starts to the half-open intersection locally (API end may be inclusive). Do not silently return contaminated full bars or invent missing prices; report upstream failures or incomplete page coverage distinctly from a genuine no-trade interval. Keep existing extended-hours=true, crypto and daily behaviour unchanged.
3. **Aggregate** — Chronologically sort minute data; first open, max high, min low, last close, sum volume/trades; volume-weighted VWAP when all required values are available and volume positive. Preserve numeric precision. Emit partial bar with time=actual intersection start and closeTime=actual intersection end; retain requested series interval. Merge with full bars by symbol/start, sorted and deduplicated. Ensure cache identity/version and data refs do not reuse old filtered output; preserve limit/page and coverage contracts.
4. **BacktestInit and replay** — Use existing candleEnd closeTime path for partial bars; confirm Alpaca closeTimeOffsetMs semantics (no extra millisecond for exclusive boundary). Preserve explicit closeTime through normalization and replay. Ensure warm-up and strategy follow identical filtering, no duplicate boundary events, and no future data. Check fill-forward duration handling and do not let missing partials be replaced by extended-hours data.
5. **OnBar contract** — Keep existing node shape and flags; no new user settings. Internal opening time and actual close must remain distinct from source availability. Coordinate with PR #968 if merged: startTimestamp is opening time and timestamp is former _sourceTimestamp; otherwise time and _sourceTimestamp retain their existing meanings. Preserve closeTime where required. Manual stepping, normal/compiled runs and history must show 14:00 UTC first on July 2. Do not repurpose opening timestamp as availability.
6. **Consolidator compatibility** — Inspect barParser, shared runConsolidatorStep, TimeBarConsolidator and compiled/dynamic execution. Carry actual input end (closeTime/endTimestamp) through parsing, use it instead of start+sourceMs for completion when present; fall back to nominal duration for existing full candles. Keep bucket selection based on opening time, not replay time. For 09:30–10:00 partial, 4h default NY bucket remains 08:00–12:00, emits at 12:00 after 11:00–12:00 input. Prevent premature emission or crossing target boundaries; preserve duplicate detection and pending-close behaviour. Do not change anchor defaults or invent session-end emissions for incomplete target buckets without verifying existing semantics.
7. **Scope** — Prefer localized Alpaca retrieval and explicit-end plumbing. No strategy/ATR/pivot logic changes, no UI expansion, no global broker behaviour changes. Review historical indicators, output validation and chart consumers for actual partial duration compatibility; change only where necessary.

## Validation / acceptance (implementation-stage tests, not executed by this plan)

- Unit fixture: 09:00–10:00 native candle contains premarket low; minute-only 09:30–10:00 aggregation excludes it, returns correct OHLCV and exact start/end. Verify 10:00–11:00 native bar unchanged.
- July 2 2021 SPY regular hours: seven replay events, UTC 14 through 20 inclusive, first opening timestamp 13:30 and closing/source availability 14:00. Extended hours enabled: original behaviour.
- Winter session UTC offset, holiday, early close, multiple symbols, missing boundary bar, no-trade minute, incomplete pagination, cancellation, warm-up/strategy boundary, manual and compiled/dynamic replay.
- 4h consolidated 08:00–12:00 NY uses three inputs (30m + 1h + 1h), emits once at 12:00; low equals min of the three, volume sum. Verify explicit-end parser behaviour and no look-ahead.
- Reproduce June 30 2021 index 20 low mismatch using raw Alpaca opening minute data and compare exact input timestamps/OHLC against QuantConnect. Same algorithm does not guarantee identical provider prices or fills; report remaining differences rather than forcing parity.
- Regression: full hourly bars, 1Min, crypto, daily and extended-hours modes unchanged.

## Rollout

Implement and review in dev; invalidate affected cached historical results and rerun the SPY backtest with identical parameters. Compare OnBar history, consolidated bars, ATR and pivot results before/after. Keep changes small and document any provider coverage differences. This document is a plan only; no production code or tests changed/run.
