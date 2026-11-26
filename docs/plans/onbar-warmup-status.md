# OnBar warm-up status

Backtest Init prepares the session. Batch runs and manual OnBar steps then emit the available candles from the configured calendar-day window. Each OnBar output has `data.isWarmingUp` set to `true` until the first candle available at or after Start Date. All symbols at the same event time share the phase.

For the reference strategy, put the If after the Consolidator, ATR, and pivot, trend, and zone calculations. Connect entry and exit evaluation to the false output.

```text
{{ $("OnBar").json.data.isWarmingUp }}
```

Store and other workflow nodes follow the graph in either phase. Order mutations and fills are disabled during warm-up. When per-bar history is enabled, warm-up bars appear in the same history list and their details show the phase.

See the calendar-day warm-up plan and rollout notes. [Plan](backtest-calendar-duration-warmup.md) · [Rollout](../release-notes/backtest-calendar-warmup.md)
