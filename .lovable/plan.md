

# Plan: Fix OnBar Output to Match BarSeries Format

## Problem

Two issues in `BacktestExecutor.ts`:

1. **Bar extraction is broken** (line 341): `brokerResult.data?.candles` returns `undefined` because all brokers (`get_candle`) return `{ BarSeries: [{ symbol, interval, bars: [...] }] }` — not `{ candles: [...] }`. This means backtests get zero bars.

2. **OnBar output uses legacy field names** (lines 529-536): `bar?.o`, `bar?.vw`, `bar?.n` are Alpaca raw format. All brokers now output universal `Bar` objects with `open`, `high`, `low`, `close`, `volume`, `vwap`, `trades`. The OnBar output should wrap the bar in the same `BarSeries` envelope so downstream access is `{{ $('OnBar').json.data.BarSeries[0].bars[0].close }}`.

## Changes — Single File

**`coreza-backend/src/nodes/executors/BacktestExecutor.ts`**

### Fix 1: Bar extraction (line 341)

```typescript
// Before
const bars = brokerResult.data?.candles || [];

// After
const barSeries = brokerResult.data?.BarSeries;
const bars = barSeries?.[0]?.bars || [];
```

### Fix 2: OnBar output format (lines 522-538)

Instead of flattening individual fields, output the bar wrapped in `BarSeries` format — matching exactly what `get_candle` returns:

```typescript
return toNodeResult(
  createSuccessOutput({
    BarSeries: [
      {
        symbol,
        interval: timeframe,
        bars: [bar],
      },
    ],
    barIndex,
  }),
);
```

This means downstream nodes access data as:
- `{{ $('OnBar').json.data.BarSeries[0].bars[0].close }}`
- `{{ $('OnBar').json.data.BarSeries[0].symbol }}`
- `{{ $('OnBar').json.data.barIndex }}`

The bar object itself contains universal fields: `time`, `open`, `high`, `low`, `close`, `volume`, `vwap`, `trades`, `quoteVolume`, `takerBuyBaseVolume`, `takerBuyQuoteVolume`, `closeTime`.

### Fix 3: Update OnBar.json description

Update the description in `src/nodes/OnBar.json` to reflect the new access pattern.

## File Summary

| File | Change |
|---|---|
| `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | Fix bar extraction from BarSeries; reformat OnBar output to BarSeries envelope |
| `src/nodes/OnBar.json` | Update description with correct template paths |

