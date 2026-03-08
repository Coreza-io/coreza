

# Plan: Add `type` to Market Data Output + Fix Stream Timeout

## Issue 1: Missing `type` field in market data output

**Root cause**: In `MarketDataSubscriber.ts` → `formatMarketEventPayload()` (line 435-460), the bar/kline branch returns `{ data: { BarSeries: [...] } }` without a `type` field. The order_update branch includes `type: "order_update"`, and the generic fallback includes `type`, but bars don't.

**Fix**: Add `type` field to the bar/kline output payload.

| File | Change |
|---|---|
| `market-stream-service/src/services/MarketDataSubscriber.ts` line 437 | Add `type: "bar"` (or `"daily_bar"` / `"kline"`) to the BarSeries data object |

```typescript
// Line 437-459: Add type field
return {
  data: {
    type: type,  // ← ADD THIS ("bar", "daily_bar", "kline")
    BarSeries: [
      {
        symbol,
        interval: event.timeframe || "1m",
        bars: [{ ... }],
      },
    ],
  },
};
```

## Issue 2: Stream node stops receiving data

**Root cause**: Two mechanisms kill the stream prematurely:

1. **Listening handler timeout** (300s = 5 min): `useListeningHandler.ts` line 230 checks `Date.now() - startTime > timeout` and calls `handleTimeout()`, which sets `isTestListening: false`. After 5 minutes with no data → stream dies.

2. **First-data resolution**: When WebSocket pushes `test_data_received`, `ExecutionStoreContext` sets `streamDataReceived: true`. The polling interval in the listening handler detects `isDataReceived()` returns true → calls `finish()` → sets `isTestListening: false` → no more data accepted.

So the stream either dies after 5 minutes (no data) or after the **first event** (data received).

**Desired behavior**: Stream should stay alive until user clicks Stop, refreshes, or changes workflow.

**Fix**: Change the streaming trigger listening config so it never auto-resolves on data received, and remove the timeout (or set it to infinity). The listening handler should only end when the user aborts (clicks Stop).

| File | Change |
|---|---|
| `src/hooks/useListeningConfigs.ts` | In `buildStreamingTriggerListeningConfig`: set `isDataReceived` to always return `false` (never auto-resolve), remove timeout (use `Infinity` or very large value like 24h) |
| `src/contexts/ExecutionStoreContext.tsx` | Already correct — keeps `isTestListening: true` on data push |

```typescript
// useListeningConfigs.ts → buildStreamingTriggerListeningConfig
return {
  ...
  isDataReceived: () => false,  // Never auto-resolve — user must stop manually
  shouldStop: (nodeData) => nodeData?.isTestListening === false,
  timeout: Number.MAX_SAFE_INTEGER,  // Effectively infinite — no auto-timeout
  ...
};
```

The recovery polling should still function as a backup data delivery mechanism but should NOT resolve the listener either — it should just update the node output and continue.

### Recovery polling change

The `recoveryPolling.processResult` currently returns `{ done: true }` when data is received, which causes the listening handler to resolve. Change it to update the node output in-place and return `{ done: false }` so recovery polling continues delivering data without killing the listener:

```typescript
recoveryPolling: {
  endpoint: recoveryEndpoint,
  interval: recoveryInterval,
  processResult: (result) => {
    if (result.status === "expired") {
      return { done: true, output: { status: "expired", message: "Test listener expired" }, expired: true };
    }
    // Data received via recovery polling — don't resolve, just continue
    return { done: false };
  },
},
```

However, we still need the recovery data to reach the node. The recovery polling in `useListeningHandler.ts` already calls `processResult` but only acts when `done: true`. We need to update the node output when recovery delivers data even if `done: false`. This means adding an `updateOutput` callback to the recovery polling result:

Actually, simpler approach — the `market_data` WebSocket handler in `ExecutionStoreContext.tsx` (line 118-138) already handles continuous updates. Recovery polling is just a fallback. If we keep the listener alive (no timeout, no auto-resolve), the WebSocket path will continuously update the node output as long as `isTestListening` is true. Recovery polling is secondary.

## Summary

| File | Change |
|---|---|
| `market-stream-service/src/services/MarketDataSubscriber.ts` | Add `type` field to bar/kline payload |
| `src/hooks/useListeningConfigs.ts` | Make streaming trigger never auto-resolve; infinite timeout |

Two files, two targeted fixes.

