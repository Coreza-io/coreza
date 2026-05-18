# Fix ADX channels (+DI / -DI not rendering)

## What you're seeing

The ADX panel currently shows only one blue line. The expected output is three lines: ADX, +DI (green), -DI (red).

## Root cause

Backend ADX output rows have keys:

```text
{ adx: number, pdi: number, mdi: number }
```

(confirmed in `coreza-backend/src/nodes/logic/indicators.ts` lines 1060 and 1076, and visible in the Input Data panel of your screenshot: `adx`, `pdi`, `mdi`).

The indicator registry in `src/utils/indicatorRegistry.ts` declares ADX channels with keys:

```text
{ key: "adx" }, { key: "plusDI" }, { key: "minusDI" }
```

`readNumeric(row, "plusDI")` returns `null` for every row → both DI channels become empty `SeriesPoint[]` arrays → only the ADX line is drawn. No error is logged because empty data is a valid render.

All other indicators check out:

- MACD → `macd`, `signal`, `histogram` (matches backend)
- BB → `upper`, `middle`, `lower` (matches)
- Stochastic → `k`, `d` (matches)
- Ichimoku → `tenkan`, `kijun`, `senkouA`, `senkouB`, `chikou` (matches)
- RSI, EMA, SMA, VWAP, OBV, Volume Oscillator, PVO → single value, working

## Fix

One file. Update only the ADX entry in `src/utils/indicatorRegistry.ts`:

```text
adx: {
  id: "adx",
  label: "ADX",
  pane: "panel",
  kind: "multi",
  channels: [
    { key: "adx",  label: "ADX",  color: "#3b82f6" },
    { key: "pdi",  label: "+DI",  color: "#22c55e" },
    { key: "mdi",  label: "-DI",  color: "#ef4444" },
  ],
},
```

No other changes needed. No backend changes. No chart code changes.

## Verification

Open Visualize with `{{ $('ADX').json.data }}`, Indicator = ADX:

- Bottom panel renders three lines: blue ADX, green +DI, red -DI.
- All three lines span the same x-range as the candles.
- Switching Indicator back to Auto falls through to the classifier (single line) — confirms registry path is the only branch affected.
- Other indicators (MACD, BB, RSI, Stochastic, S&R) remain unchanged.
