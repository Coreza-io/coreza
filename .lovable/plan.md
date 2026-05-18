# Align `indicatorRegistry.ts` channel keys with backend output

Stop forcing the backend to change. The frontend registry should mirror the exact keys the backend's historical path (which feeds Visualize) emits. Audit every indicator and fix mismatches.

## Backend output shapes (historical / Visualize path)

| Indicator | File location | Row shape produced |
|---|---|---|
| RSI | `indicators.ts` calculateRSI | `number` (plain) |
| EMA | calculateEMA | `number` |
| SMA | calculateSMA | `number` |
| MACD | calculateMACD | `{ macd, signal, histogram }` |
| Bollinger Bands | calculateBollingerValues | `{ upper, middle, lower, bb_width }` |
| ADX | calculateADX (library) | `{ adx, pdi, mdi }` |
| Stochastic | calculateStochastic (library) | `{ k, d }` |
| Ichimoku | calculateIchimoku (library) | `{ conversion, base, spanA, spanB }` — no chikou |
| VWAP | calculateVWAP | `{ timestamp, vwap, sessionStart }` |
| OBV | calculateOBV | `{ timestamp, obv }` |
| Volume Oscillator | calculateVolumeOscillator | `number` |
| PVO | (no backend function found) | n/a |
| Support/Resistance | calculatePivot/Swing/Historical | `{ support: number[], resistance: number[], ... }` |

## Registry mismatches to fix

In `src/utils/indicatorRegistry.ts`:

### 1. Ichimoku — replace channel keys, drop `chikou`
```text
ichimoku: {
  pane: "price", kind: "multi",
  channels: [
    { key: "conversion", label: "Tenkan (Conversion)",  color: "#3b82f6" },
    { key: "base",       label: "Kijun (Base)",         color: "#f59e0b" },
    { key: "spanA",      label: "Senkou Span A",        color: "#22c55e" },
    { key: "spanB",      label: "Senkou Span B",        color: "#ef4444" },
  ],
}
```
Remove `aliases`. Chikou not produced by the historical library path — omit it (no point showing an always-empty line).

### 2. VWAP — channel key `vwap`
```text
{ key: "vwap", label: "VWAP", color: "#14b8a6" }
```

### 3. OBV — channel key `obv`
```text
{ key: "obv", label: "OBV", color: "#6366f1" }
```

### 4. PVO — no backend function exists
Either remove the `pvo` entry from the registry/dropdown, or leave it with a note that the backend doesn't emit it yet. Recommend removal until backend is added.

### Unchanged (already correct)
- RSI / EMA / SMA / Volume Oscillator — backend returns plain `number`; registry `{ key: "value" }` continues to work because `VisualizeNodePreview` treats numeric rows as the channel value regardless of key.
- MACD, Bollinger Bands, ADX, Stochastic, Support/Resistance — keys already match.

## Files touched

- `src/utils/indicatorRegistry.ts` — only file. No backend changes. No chart code changes. No `aliases` mechanism needed.

## Verification

- Ichimoku → 4 lines on price chart (Tenkan/Kijun/Senkou A/Senkou B), values match the `conversion/base/spanA/spanB` shown in the input panel.
- VWAP → single line on price chart.
- OBV → single line on panel chart.
- MACD / BB / ADX / RSI / Stochastic / S&R remain working.

## Note on the incremental updater divergence

The streaming/incremental path still emits `{tenkan, kijun, senkouA, senkouB, chikou}` for Ichimoku and is consumed by live engine logic — not by Visualize. Leaving it alone here. If you later want a single canonical shape for both paths, that's a separate backend task and would require regenerating golden fixtures and updating `indicatorIncrementalParity.ichimoku.test.ts`.
