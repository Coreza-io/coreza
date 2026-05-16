# Visualize node — multi-series chart with drag-and-drop fields

## Goal

Turn the Visualize node from "auto-grab whatever the previous node emitted" into a configurable chart where the user explicitly maps each data slice onto the chart via drag-and-drop reference fields:

1. **Candle Data** (required) — OHLCV bars draw the price chart.
2. **Overlays** (repeater, 0..n) — each item maps any input (BB, S/R, EMA, RSI, Volume Oscillator, raw arrays, etc.) to either a chart overlay (drawn on price pane) or a sub-panel (drawn below). Adding/removing rows updates the chart live.

## UX

```text
┌─ Visualize Candles & Signals ─────────────┐
│ Candle Data  [ {{ $('Alpaca').json.data.BarSeries[0].bars }} ]  (drag here)
│                                            │
│ Overlays                          [+ Add]  │
│  ┌──────────────────────────────────────┐  │
│  │ Name:   BB(20,2)                     │  │
│  │ Data:   {{ $('BB').json.data }}      │  │
│  │ Render: Auto ▾  Color: #3b82f6  [x]  │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ Name:   Support/Resistance           │  │
│  │ Data:   {{ $('S&R').json.data }}     │  │
│  │ Render: Auto ▾  Color: #8b5cf6  [x]  │  │
│  └──────────────────────────────────────┘  │
│                                            │
│ ── Price chart with candles + BB ──        │
│ ── Horizontal S/R lines on price pane ──   │
│ ── Volume Oscillator pane (below) ──       │
└────────────────────────────────────────────┘
```

Render select: `auto | line | bands | levels | panel`. Default `auto` infers from payload shape.

## Data shape detection (Auto)

Given a resolved value, classify in this order:

1. **bands** — object with at least two of `{upper, middle, lower}` (BB-style), each an array of numbers or `{time,value}`.
2. **levels** — object with `support` and/or `resistance` arrays of numbers (S/R historical/pivot), OR array of `{level, type: 'support'|'resistance'}`. Drawn as horizontal `ReferenceLine`s on the price pane.
3. **panel** — single-series oscillator that lives outside price range (Volume Oscillator, RSI, MACD). Heuristic: numeric series whose range does not overlap candle close range, OR explicit `panel: true` flag, OR known names (`rsi`, `macd`, `volume_oscillator`, `pvo`, `obv`, `adx`, `stochastic`). Drawn in a stacked secondary `ComposedChart` below the price chart, sharing the X axis.
4. **line** — fallback. Any numeric array or `{time,value}[]` mapped onto the price pane.

Each detector normalizes payload variants:
- `BarSeries[0].bars`, `data.BarSeries[0].bars`, `bars`, `candles`, top-level array — already handled in current resolver, extract once and reuse.
- Series can be: `number[]`, `{time|t, value|v}[]`, `{time, upper, middle, lower}[]`, etc.
- Time normalization: numeric epoch → ISO date slice (current helper extended).

## Files to change

**Schema**
- `src/nodes/Visualize.json` — replace the two hidden json fields with:
  - `candles` — `type: "string"` (drag-droppable), `label: "Candle Data"`, required.
  - `overlays` — `type: "repeater"`, `subFields`: `name` (string), `data` (string, drag-droppable), `render` (select: Auto/Line/Bands/Levels/Panel), `color` (text, default rotating palette).

**Layout**
- `src/components/nodes/layout/BasicNodeLayout.tsx` — for `isVisualize`, stop reading `selectedInputData` directly. Instead read `fieldState.candles` and `fieldState.overlays`, resolve each reference string via the existing `resolveReferences` util against the node's upstream context (same context the renderer already builds for previews), then:
  - extract bars from the resolved `candles` value using the existing `findBars` + `toDictOfArrays` helpers (move them to a small util `src/utils/visualizeNormalize.ts`).
  - for each overlay row, resolve `data`, run the classifier above, and build a typed overlay descriptor.
  - pass `{candles, overlays}` to the chart.

**Chart**
- `src/components/charts/VisualizeCandlesSignals.tsx` — extend props:
  ```ts
  type Overlay =
    | { kind: 'line';   name: string; color: string; values: (number|null)[] }
    | { kind: 'bands';  name: string; color: string; upper: (number|null)[]; middle?: (number|null)[]; lower: (number|null)[] }
    | { kind: 'levels'; name: string; supports: number[]; resistances: number[] }
    | { kind: 'panel';  name: string; color: string; values: (number|null)[] };
  interface Props { candles: CandleData; overlays?: Overlay[]; }
  ```
  - Line/Bands merged into the price `ComposedChart` as additional `Line` series; bands also render a translucent area between upper/lower using two `Area` components or a stacked invisible+visible pattern.
  - Levels render as `ReferenceLine` on the price pane (green for support, red for resistance, dashed, label = numeric value).
  - Panels render in a second `ComposedChart` below, one shared `XAxis` category with the price chart (same `timestamp` domain). Multiple panel overlays stack vertically (height ~120px each).
  - Drop the old single `indicator` prop and the `Buy/Sell` legend (signals were never wired). Keep volume toggle.

**Utility**
- `src/utils/visualizeNormalize.ts` (new) — `extractBars`, `normalizeTime`, `classifyOverlay`, `alignSeriesToCandles` (pad/align by length or by timestamp when both have time).

## Out of scope

- No backend changes. No new indicator semantics. No persistence of chart preferences beyond the existing field state.
- Buy/Sell trade markers can be added later as a dedicated overlay `kind: 'signals'` — not in this pass.

## Verification

- Connect Alpaca → BB → Visualize. Drag `Alpaca.bars` into Candle Data, drag `BB.data` into an overlay row. Chart shows candles plus BB upper/middle/lower with shaded band.
- Add a second overlay row with Volume Oscillator output. A panel renders below the price chart.
- Add a third overlay row with Support/Resistance output. Horizontal dashed lines appear on the price pane in the right colors.
- Remove an overlay row → corresponding series disappears immediately.
- Empty Candle Data field → existing "No candle data" empty state.
