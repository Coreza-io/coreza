

# Plan: Alpaca Bar Streaming — 3 Variations (Minute Bars, Daily Bars, Updated Bars)

## Background

Alpaca's WebSocket streams have three bar-related message types:
- **`b` (bars)** → Completed 1-minute bars, sent once per minute when candle closes
- **`d` (dailyBars)** → Completed daily bars, sent once per day
- **`u` (updatedBars)** → Tick-level updated bars, sent continuously as trades occur within a minute window (partial/in-progress candle)

Currently, the system only subscribes to `bars` and `dailyBars`. Updated bars (`u`) are not handled at all — they're filtered out by `shouldPublishAlpacaMessage` and have no normalizer case.

## What We're Building

1. Replace the single "Bars" option with "Minute Bars" and "Daily Bars" in `stream_types`
2. Add a "Bar Interval" selector (1m / 1d) that shows when either bar type is selected — this controls what the user expects
3. Add a "Close Bars Only" checkbox (like Binance klines) — when checked, only completed minute bars (`b`) are emitted; when unchecked, updated/partial bars (`u`) stream continuously
4. Wire the backend to subscribe to `updatedBars` when close bars is off, and filter accordingly

## Detailed Changes

### 1. Node JSON — `AlpacaSubscribe.json`

Update `stream_types` options:
```
- { id: "bar", name: "Bars" }
+ { id: "bar", name: "Minute Bars (1min Candles)" }
+ { id: "daily_bar", name: "Daily Bars (EOD Candles)" }
```

Add `close_bars` checkbox field:
```json
{
  "key": "close_bars",
  "label": "Close Bars Only",
  "type": "checkbox",
  "default": true,
  "description": "When checked, only emit completed 1-min bars. When unchecked, emit continuous updated bars (tick-level).",
  "showDescription": true,
  "displayOptions": {
    "show": {
      "stream_types": ["bar"],
      "data_type": ["market", "crypto"]
    }
  }
}
```

Remove the `interval` field entirely — it's redundant since `bar` = 1m and `daily_bar` = 1d by nature of the Alpaca API.

### 2. Node JSON — `AlpacaStreamData.json`

Update `stream_types` and `filter_types` options to match:
```
- { id: "bar", name: "Bars" }
+ { id: "bar", name: "Minute Bars" }
+ { id: "daily_bar", name: "Daily Bars" }
+ { id: "updated_bar", name: "Updated Bars (Continuous)" }
```

### 3. Backend — Alpaca Helpers (`helpers.ts`)

**Type mapping** — add `updated_bar`:
```typescript
const ALPACA_TYPE_TO_KEY = {
  ...existing,
  updated_bar: "updatedBars",
  updatedBars: "updatedBars",
};
```

**`shouldPublishAlpacaMessage`** — add `"u"` to allowed types:
```typescript
return ["t", "q", "b", "d", "u"].includes(msg.T);
```

**`normalizeAlpacaMessage`** — add case for `"u"`:
```typescript
case "u":
  return {
    source: "alpaca" as const,
    symbol,
    t,
    type: "updated_bar" as const,
    o: msg.o, h: msg.h, l: msg.l, c: msg.c,
    v: msg.v, vw: msg.vw,
    timeframe: "1m",
  };
```

### 4. Backend — Subscribe Handler (`MarketControlHandler.ts`)

When processing Alpaca subscribe requests:
- If `stream_types` includes `"bar"` and `close_bars` is `true` (default): subscribe to `bars` only
- If `stream_types` includes `"bar"` and `close_bars` is `false`: subscribe to `updatedBars` only (updated bars are the superset — they stream continuously)
- If `stream_types` includes `"daily_bar"`: subscribe to `dailyBars`

This logic goes in `processEventTypesForStreamNames` — currently it only handles Binance. Add Alpaca handling:
```typescript
if (source.startsWith("alpaca")) {
  return eventTypes.map(type => {
    if (type === "bar" && !closeBars) return "updated_bar";
    return type;
  });
}
```

The `close_bars` flag needs to be passed through from the subscribe request to this method.

### 5. Market Event Types (`marketEvent.ts`)

Add `"updated_bar"` to the `CorezaMarketEvent` type union.

### 6. Subscriber Formatting (`MarketDataSubscriber.ts`)

The existing bar formatting already handles all bar types via the check `type === "bar" || type === "daily_bar"`. Add `"updated_bar"` to that condition:
```typescript
if (type === "kline" || type === "bar" || type === "daily_bar" || type === "updated_bar") {
```

## Files to Change

| File | Change |
|---|---|
| `src/nodes/AlpacaSubscribe.json` | Split "Bars" into "Minute Bars" + "Daily Bars", add `close_bars` checkbox, remove `interval` field |
| `src/nodes/AlpacaStreamData.json` | Add `daily_bar` and `updated_bar` to filter options |
| `coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts` | Add `updatedBars` mapping, `"u"` publish filter, `"u"` normalizer case |
| `coreza-backend/market-stream-service/src/types/marketEvent.ts` | Add `"updated_bar"` to type union |
| `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts` | Include `updated_bar` in bar formatting condition |
| `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts` | Map `bar` → `updated_bar` when `close_bars` is false in `processEventTypesForStreamNames` |

