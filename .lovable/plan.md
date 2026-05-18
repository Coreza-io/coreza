# Fix Ichimoku rendering (key-name mismatch)

## What you're seeing

Ichimoku with Indicator = Ichimoku shows no lines on the chart. Input Data shows rows like `{conversion, base, spanA, spanB}`.

## Root cause

The Ichimoku backend has two code paths that emit **different keys**:

- Incremental updater (`coreza-backend/src/nodes/logic/indicators.ts` line 781) returns `{tenkan, kijun, senkouA, senkouB, chikou}`.
- Historical `calculateIchimoku` (line 1603) delegates to the `technicalindicators` library, which returns `{conversion, base, spanA, spanB}` — no `chikou`.

The Visualize node receives the historical shape. The registry channels only declare the incremental keys (`tenkan`, `kijun`, ...), so `readNumeric(row, "tenkan")` returns `null` for every row and all five channels render as empty arrays.

Same class of bug as ADX (`pdi`/`mdi` vs `plusDI`/`minusDI`), but here the backend itself is inconsistent. Rather than risk breaking the live/streaming path by renaming backend keys, the frontend registry should accept either spelling.

## Fix

Two small changes, frontend only. No backend changes.

### 1. `src/utils/indicatorRegistry.ts`

Add an optional `aliases?: string[]` to `IndicatorChannel`, and update the Ichimoku spec to list both naming conventions:

```text
ichimoku: {
  id: "ichimoku",
  label: "Ichimoku",
  pane: "price",
  kind: "multi",
  channels: [
    { key: "tenkan",  aliases: ["conversion"], label: "Tenkan",  color: "#3b82f6" },
    { key: "kijun",   aliases: ["base"],       label: "Kijun",   color: "#f59e0b" },
    { key: "senkouA", aliases: ["spanA"],      label: "Senkou A", color: "#22c55e" },
    { key: "senkouB", aliases: ["spanB"],      label: "Senkou B", color: "#ef4444" },
    { key: "chikou",                            label: "Chikou",  color: "#8b5cf6" },
  ],
},
```

The `chikou` channel will remain empty for the historical path (the library doesn't produce it) — that's expected and matches what the data contains.

### 2. `src/components/nodes/visualize/VisualizeNodePreview.tsx`

Teach the channel readers to try aliases. Two touch points:

- `readNumeric(row, key, aliases?)` — after the primary `key` returns `null`, try each alias in order.
- `buildChannelSeries(candles, rows, key, aliases?)` — pass aliases through. Same for the `rowsHaveRealTime` check (unchanged) and the numeric tail-align branch.

Wire it in the registry-path loop: `buildChannelSeries(candles, seriesRows, channel.key, channel.aliases)`.

No other indicators need aliases today, but the mechanism is now in place for any future drift.

## Verification

- Ichimoku with Indicator = Ichimoku → four overlay lines on the price chart (Tenkan blue, Kijun orange, Senkou A green, Senkou B red). Chikou legend entry present but no line (data not provided by backend).
- ADX with Indicator = ADX → still renders 3 lines (regression check).
- MACD / BB / RSI / Stochastic / S&R → unchanged.
- Auto on Ichimoku → falls through to the classifier (existing behavior).
