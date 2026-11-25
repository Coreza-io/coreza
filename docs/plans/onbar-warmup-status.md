# Expose warm-up status in OnBar

## Expected behavior

Add a boolean `isWarmingUp` alongside `BarSeries` and `barIndex` in OnBar's `data` output. It is `true` for pre-start bars processed during Workflow Replay and `false` for regular backtest bars, including manual OnBar steps. Direct Seed initializes state without emitting replay bars.

## Minimal changes

1. In [BacktestExecutor.ts](../../coreza-backend/src/backtest/BacktestExecutor.ts), initialize `isWarmingUp` to `false` in the reusable `executeOnBar` result and assign `context?.isWarmingUp === true` on every call. [BacktestSession](../../coreza-backend/src/backtest/session/BacktestSession.ts) already derives the flag from the session phase and passes it to the dynamic and compiled execution contexts. Assigning it on each call ensures the first regular bar reports `false` after replay.
2. In [BacktestSession.ts](../../coreza-backend/src/backtest/session/BacktestSession.ts), include `isWarmingUp: false` in the step response payloads that carry bar data, including the empty manual bar payload. The [manual OnBar route](../../coreza-backend/src/routes/backtest.ts) already returns that payload. Keep its existing completion response shape when there is no bar.
3. In [OnBar.json](../../src/nodes/OnBar.json), document the boolean and add the expression below to the node description.

```text
{{ $("OnBar").json.data.isWarmingUp }}
```

## Workflow use

Run the Consolidator and strategy-state calculations before the If node. Route Store Variables or trade submission through the `false` branch. For a value needed on warm-up bars, such as `wick_score`, use a warm-up-safe source such as Persistent Edit Fields. The flag uses the current warm-up policy, including its restrictions on storage and trading.

Scope is the OnBar output and node description. Testing is outside this plan.
