# Visualize node — composite plan (Lightweight Charts + multi-series drag-and-drop)

## Synthesis of the two plans

| Topic | Previous Lovable plan | Uploaded PDF plan | Composite decision |
|---|---|---|---|
| UX | Candle Data field + Overlays repeater | Same | Keep — identical |
| Field schema | `string` (drag-droppable) candles + `repeater` overlays with name/data/render/color | Same | Keep |
| Auto-classifier order | bands → levels → panel → line | Same | Keep |
| Renderer | Recharts `ComposedChart`, `ReferenceLine`, second stacked chart | **TradingView Lightweight Charts** (candles, histogram, line, priceLine, panes) | **Switch to Lightweight Charts** — purpose-built for OHLC, better perf, crosshair, time scale |
| Bands fill | Two `Area` components | Three line series first; shaded fill in phase 2 via primitive | Three lines first; defer shaded fill |
| S/R | `ReferenceLine` on price pane | `createPriceLine` for fixed levels, `LineSeries` for historical | Use both based on shape |
| Panels (oscillators) | Stacked second `ComposedChart` | Lightweight Charts panes if version supports, else synced chart instances | Detect at runtime; one second chart instance with shared time scale for v4 |
| Component layering | All logic in `BasicNodeLayout` | **Extract** to `VisualizeNodePreview` + `visualizeNormalize` util + `LightweightVisualizeChart` adapter + `chartTypes.ts` | Adopt layered split — cleaner and chart-renderer-replaceable |
| Tests | Manual verification | Pure-function unit tests for normalizer | Add normalizer unit tests |
| Signals | Out of scope | Out of scope this pass, reserve `signals` overlay kind | Same |

## Goal

The Visualize node becomes an explicit multi-series chart node powered by TradingView Lightweight Charts. Users drag-and-drop one Candle Data reference plus 0..n Overlay rows. Each overlay is resolved, classified, aligned to candles, and rendered on the price pane or in a synchronized lower pane.

## UX

```text
┌─ Visualize Candles & Signals ──────────────────────────────┐
│ Candle Data  {{ $('Alpaca').json.data.BarSeries[0].bars }} │
│                                                            │
│ Overlays                                         [+ Add]   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Name BB(20,2)                                        │  │
│  │ Data {{ $('BB').json.data }}                         │  │
│  │ Render Auto ▾    Color #3b82f6    [x]                │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Name S/R   Data {{ $('S&R').json.data }}             │  │
│  │ Render Auto ▾    Color #8b5cf6    [x]                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│ ── Price pane: candles + volume + BB lines + S/R lines ── │
│ ── Lower pane: Volume Oscillator (synced time scale) ───   │
└────────────────────────────────────────────────────────────┘
```

`Render` options: `Auto | Line | Bands | Levels | Panel`. Default `Auto`.

## Data flow

```text
fieldState
  → resolveReferences(candles, upstreamCtx)
  → extractBars → normalize OHLCV + time
  → for each overlay row:
       resolveReferences(row.data)
       classifyOverlay(row.name, row.render, resolved, candles)
       alignSeriesToCandles(...)
  → build VisualizeChartViewModel { candles, overlays[], options }
  → LightweightVisualizeChart renders
```

## Component layering

```text
src/
  nodes/Visualize.json                                    (schema)
  components/
    nodes/
      layout/BasicNodeLayout.tsx                          (delegates only)
      visualize/VisualizeNodePreview.tsx                  (resolver → viewmodel)
    charts/
      LightweightVisualizeChart.tsx                       (only file importing lightweight-charts)
      chartTypes.ts                                       (CorezaCandle, VisualizeOverlay union, ViewModel)
      chartSeriesBuilder.ts                               (overlay → series calls)
  utils/
    visualizeNormalize.ts                                 (extractBars, normalizeTime, classifyOverlay, alignSeriesToCandles, palette)
```

Chart adapter knows nothing about workflow references or Coreza payload variants — it consumes the clean ViewModel.

## Data contracts (`chartTypes.ts`)

```ts
export type CorezaCandle = {
  time: number;             // epoch seconds (Lightweight Charts native)
  open: number; high: number; low: number; close: number;
  volume?: number;
};

export type SeriesPoint = { time: number; value: number | null };

export type VisualizeOverlay =
  | { kind: 'line';   id: string; name: string; color: string; pane: 'price'; data: SeriesPoint[] }
  | { kind: 'bands';  id: string; name: string; color: string; pane: 'price';
      upper: SeriesPoint[]; middle?: SeriesPoint[]; lower: SeriesPoint[] }
  | { kind: 'levels'; id: string; name: string;
      supports: number[]; resistances: number[];
      // optional historical series (time-varying levels) rendered as lines
      supportSeries?: SeriesPoint[]; resistanceSeries?: SeriesPoint[] }
  | { kind: 'panel';  id: string; name: string; color: string; data: SeriesPoint[] };

export type VisualizeChartViewModel = {
  candles: CorezaCandle[];
  overlays: VisualizeOverlay[];
  options: { showVolume: boolean; showLegend: boolean; autoFit: boolean };
};
```

## Overlay classifier (Auto)

Order: **bands → levels → panel → line**.

1. **bands** — object with ≥2 of `{upper, middle, lower}` arrays, OR array of `{time, upper, middle, lower}`.
2. **levels** — object with `support`/`resistance` arrays, OR array of `{level, type: 'support'|'resistance'}`. If entries carry timestamps → also populate `supportSeries`/`resistanceSeries` for historical rendering; otherwise treat as fixed price lines.
3. **panel** — single numeric series whose range does not overlap the candle close range, OR explicit `panel: true`, OR known oscillator name (`rsi`, `macd`, `volume_oscillator`, `pvo`, `obv`, `adx`, `stoch`).
4. **line** — fallback. `number[]` or `{time|t, value|v}[]`.

User-selected `Render` overrides Auto.

## Accepted candle shapes

`data.BarSeries[0].bars`, `BarSeries[0].bars`, `bars`, `candles`, array of `{time,open,high,low,close,volume}`, array of `{t,o,h,l,c,v}`, dict-of-arrays `{time:[],open:[],...}`. Already partially in `BasicNodeLayout` — relocated and extended in `visualizeNormalize.ts`.

## Time normalization

- number < 1e12 → epoch seconds (pass through to Lightweight Charts as-is)
- number ≥ 1e12 → epoch ms → divide by 1000
- numeric string → same rules
- ISO string → `Math.floor(Date.parse(s)/1000)`
- Result is always epoch seconds (Lightweight Charts `UTCTimestamp`).

## Series alignment

- If both candles and overlay carry timestamps → join by epoch second; missing slots become `null`.
- If overlay is a bare `number[]` shorter than candles → right-align to the end of the candle series (warmup padding) with leading `null`s.

## Rendering plan (Lightweight Charts)

| Element | Series / API |
|---|---|
| Candles | `CandlestickSeries` on main pane |
| Volume | `HistogramSeries` with bottom scale margins (same pane) |
| Line overlay (EMA/SMA/VWAP/raw) | `LineSeries` on price pane |
| Bollinger Bands | 3 × `LineSeries` (upper/middle/lower) on price pane; shaded fill deferred |
| Fixed S/R levels | `series.createPriceLine()` per level (green for support, red for resistance, dashed) |
| Historical S/R | `LineSeries` per side |
| Oscillator panel | Second `createChart` instance below, height ~140px, **subscribe both `timeScale().subscribeVisibleLogicalRangeChange`** to keep ranges synced. If installed version exposes `panes`, prefer panes API. |

Resize via `ResizeObserver`. Cleanup via `chart.remove()` in `useEffect` return.

## Files to change

**New**
- `src/components/charts/chartTypes.ts`
- `src/components/charts/LightweightVisualizeChart.tsx`
- `src/components/charts/chartSeriesBuilder.ts`
- `src/components/nodes/visualize/VisualizeNodePreview.tsx`
- `src/utils/visualizeNormalize.ts`
- `tests/utils/visualizeNormalize.test.ts`

**Edit**
- `src/nodes/Visualize.json` — replace hidden json fields with `candles` (string, drag-droppable) + `overlays` (repeater: name, data, render select, color).
- `src/components/nodes/layout/BasicNodeLayout.tsx` — remove inlined viz logic; when `definition.name === 'Visualize'` render `<VisualizeNodePreview ... />`.

**Delete**
- `src/components/charts/VisualizeCandlesSignals.tsx` — replaced by `LightweightVisualizeChart`.

## Dependencies

```bash
bun add lightweight-charts
```

## Implementation phases

1. **Schema + repeater wiring** — `Visualize.json` + verify field state persists through `useNodeFieldState`.
2. **Normalizer + unit tests** — `extractBars`, `normalizeTime`, `classifyOverlay`, `alignSeriesToCandles`, `getPaletteColor`. Cover BB, S/R (pivot/historical), Volume Oscillator, raw arrays, mixed time shapes.
3. **Basic chart** — `LightweightVisualizeChart` renders candles + volume from view model.
4. **Resolver** — `VisualizeNodePreview` reads fieldState, calls `resolveReferences`, produces ViewModel.
5. **Price overlays** — line, bands (3 lines), S/R (price lines + historical lines).
6. **Panel overlays** — second chart instance with synced time scale.
7. **Polish** — color palette rotation, legend chips, resize observer, unmount cleanup, empty states.
8. **Defer** — band shaded fill, signals markers, tooltips with crosshair legend, drawing tools.

## Verification

- Alpaca → BB → Visualize: drag bars into Candle Data, drag BB.data into an overlay → candles + 3 BB lines render on price pane.
- Add S/R overlay → horizontal dashed price lines (green/red) appear at correct values.
- Add Volume Oscillator → renders in lower pane; zooming/scrolling top pane scrolls bottom pane.
- Remove an overlay row → corresponding series/price lines disappear without remounting the chart.
- Change overlay color → re-renders that series only.
- Epoch seconds vs ms vs ISO all render at correct dates.
- Shorter indicator series right-aligns to candle end.
- Unmount/remount: no leaked chart instances (verify in devtools memory).
- Empty Candle Data → "No candle data" empty state.

## Out of scope

- Backend changes.
- Buy/sell signal markers (reserved as future `kind: 'signals'`).
- Shaded band fill, drawing tools, custom tooltip chrome.
