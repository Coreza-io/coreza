# Fix Visualize node — candle data not rendering

## Problem

The Visualize node shows "No candle data to visualize" even when the previous node (Alpaca) outputs valid bar data. The input shape coming in is the standardized `BarSeries` format:

```text
{
  success: true,
  data: {
    BarSeries: [
      {
        symbol: "BKSY",
        interval: "1Day",
        bars: [
          { time: 1704171600000, open: 1.38, high: 1.39, low: 1.34, close: 1.38, volume: 631074 },
          ...
        ]
      }
    ]
  }
}
```

The current resolver in `BasicNodeLayout.tsx` only looks at `firstInput.candles` or a top-level array, and only maps the short keys `{t,o,h,l,c,v}`. It also calls `.slice(0,10)` on `time`, which is a numeric epoch, not a string — that throws or yields garbage.

## Fix (frontend only)

Update the `vizCandles` memo in `src/components/nodes/layout/BasicNodeLayout.tsx`:

1. Locate bars by trying, in order:
   - `firstInput.data?.BarSeries?.[0]?.bars`
   - `firstInput.BarSeries?.[0]?.bars`
   - `firstInput.bars`
   - `firstInput.candles`
   - `firstInput` itself if it's an array
2. In `toDictOfArrays`, accept both key styles per bar:
   - short: `t,o,h,l,c,v`
   - long:  `time, open, high, low, close, volume`
3. Normalize `time`:
   - if number → `new Date(t).toISOString().slice(0,10)`
   - if string → `t.slice(0,10)`

No backend changes. No changes to chart component or Visualize.json.

## Verification

Reload the Visualize node with Alpaca BarSeries input — the chart should render the candles. Confirm via screenshot.
