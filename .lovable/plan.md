# Fix MACD + restore BB rendering after indicator-registry rollout

## What is happening on screen

- MACD: nothing visible. No second panel under the candle chart.
- BB: previously rendered as 3 lines on the price chart; after selecting Indicator = "Bollinger Bands" it disappears.
- Support & Resistance: still works (only because its registry branch ignores per-row times).

## Two confirmed root causes

### Cause A — multi-panel overlays are sent to the price chart

`src/components/charts/LightweightVisualizeChart.tsx`:

```text
panelOverlays = overlays.filter(o => o.kind === "panel")
priceOverlays = overlays.filter(o => o.kind !== "panel")
```

MACD is `{ kind: "multi", pane: "panel" }`. It is **not** `kind === "panel"`, so it never goes to the panel chart. The second chart container is also gated by `panelOverlays.length > 0`, so the second pane is never even created. MACD lines are added to the price chart, where the y-scale is dominated by candle prices and MACD values (~0.005) collapse to a flat line at the bottom axis — effectively invisible.

This explains "MACD not showing" by itself, but does **not** explain BB. BB is `kind: "bands"`, `pane: "price"` — it should still render on the price chart. The reason it disappeared is Cause B.

### Cause B — `buildSeriesPoints` fabricates fake timestamps that defeat `alignSeriesToCandles`

`src/components/nodes/visualize/VisualizeNodePreview.tsx > readTime` returns the **row index** when a row has no `time` field:

```text
readTime(row, fallbackIndex) -> 0, 1, 2, 3, ...
```

`buildSeriesPoints` then produces rows like `[{time: 0, value: 0.004}, {time: 1, value: 0.005}, ...]` and passes them into `alignSeriesToCandles`.

Inside `alignSeriesToCandles` (`src/utils/visualizeNormalize.ts`):

1. `allNumeric` check uses `toFiniteNumber(value)` on each element. Our elements are **objects** `{time, value}`, so `toFiniteNumber({...}) === null`. `allNumeric` is false → tail-alignment path is skipped.
2. The fallback path builds a Map keyed by `point.time` (via `normalizeSeriesPoint`) and looks up `byTime.get(candle.time)`. Candle `time` is a real UTC second (e.g. 1716060000). Our keys are 0, 1, 2, ... → **every lookup misses**, every output value is `null`, nothing is drawn.

This is why BB stopped rendering as soon as the user picked "Bollinger Bands": the registry path runs `buildSeriesPoints` for `upper`, `middle`, `lower` and all three series become full of nulls. The same problem kills MACD's channels even if Cause A is fixed.

S&R survives only because its registry branch never goes through `buildSeriesPoints` — it reads `support` / `resistance` arrays from the latest row directly.

## Fix

### 1. Route multi overlays by `pane`, not by `kind`

`src/components/charts/LightweightVisualizeChart.tsx`:

```text
const isPanelOverlay = (o) =>
  o.kind === "panel" || (o.kind === "multi" && o.pane === "panel");

const panelOverlays = overlays.filter(isPanelOverlay);
const priceOverlays = overlays.filter((o) => !isPanelOverlay(o));
```

No other change needed in this file. The lazy second-chart creation already kicks in once `panelOverlays.length > 0`. `addOverlaySeries` already handles `kind: "multi"` correctly on whichever chart it receives.

### 2. Pick the right alignment strategy per channel in `VisualizeNodePreview.tsx`

Introduce one helper and use it in the `bands` and `channels` branches of the registry path:

```text
const rowsHaveRealTime = (rows) =>
  rows.some((r) => {
    if (typeof r !== "object" || r === null) return false;
    const rec = unwrapRow(r);
    if (typeof rec !== "object" || rec === null) return false;
    const t = (rec as any).time ?? (rec as any).t ?? (rec as any).timestamp;
    return typeof t === "number" || typeof t === "string";
  });

const buildChannelSeries = (candles, rows, key) => {
  if (rowsHaveRealTime(rows)) {
    // {time, value}[] -> alignSeriesToCandles via byTime path (real timestamps)
    return alignSeriesToCandles(candles, buildSeriesPoints(rows, key));
  }
  // number[] -> alignSeriesToCandles via allNumeric tail-alignment path
  const numeric = rows.map((r) => readNumeric(r, key) ?? NaN);
  return alignSeriesToCandles(candles, numeric);
};
```

Notes:

- `NaN` is intentional: `toFiniteNumber(NaN)` returns `null`, which fails the `allNumeric` check. So we instead substitute missing entries with `0`? No — we must keep `allNumeric` true. Use `Number.NaN` and update only the `allNumeric` check? Cleaner: filter to a clean number array. Since indicators that lack `time` are always candle-aligned tail series, we can pass `rows.map((r) => readNumeric(r, key)).filter((v) => v !== null) as number[]` — `alignSeriesToCandles` already pads the front when the resulting array is shorter than the candle window.

Final helper:

```text
const buildChannelSeries = (candles, rows, key) => {
  if (rowsHaveRealTime(rows)) {
    return alignSeriesToCandles(candles, buildSeriesPoints(rows, key));
  }
  const numeric = rows
    .map((r) => readNumeric(r, key))
    .filter((v) => v !== null) as number[];
  return alignSeriesToCandles(candles, numeric);
};
```

Replace the three `alignSeriesToCandles(candles, buildSeriesPoints(seriesRows, ...))` calls in:

- The `bands` branch (`upper`, `middle`, `lower`).
- The `channels.map(...)` block in the `multi` branch.

Levels branch stays as is. Auto-classifier path (no `indicatorType` or `auto`) stays as is.

### 3. No changes needed in

`indicatorRegistry.ts`, `chartTypes.ts`, `lightweightSeriesBuilder.ts`, `visualizeNormalize.ts`, `Visualize.json`, drag/drop hooks, backend.

## Verification checklist

1. Overlay row with `{{ $('MACD').json.data }}`, Indicator = MACD
   - Second pane appears under the candle chart.
   - Blue MACD line, dashed orange Signal line, purple Histogram bars all visible.
   - Price pane y-scale stays focused on candles.
2. Overlay row with `{{ $('BB').json.data }}`, Indicator = Bollinger Bands
   - Three lines (upper solid, middle dashed, lower solid) render on the price chart, hugging price.
3. Overlay row with `{{ $('SR').json.data }}`, Indicator = Support & Resistance
   - Exactly 3 green + 3 red dashed horizontal lines with price-only axis labels. No duplicates after edits.
4. Overlay row with Indicator = Auto on any of the above payloads
   - Classifier path renders the same as before this change (regression check).
5. RSI with Indicator = RSI
   - Panel with single line plus dashed 30/70 reference lines.
6. Remove an overlay row — corresponding lines disappear cleanly from the correct pane.

## Files touched

- `src/components/charts/LightweightVisualizeChart.tsx` — `isPanelOverlay` split.
- `src/components/nodes/visualize/VisualizeNodePreview.tsx` — `rowsHaveRealTime` + `buildChannelSeries`; use it in bands + multi branches.
