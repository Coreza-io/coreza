# Review of implementation + two bugs preventing MACD from rendering

The dropdown, registry, `multi` overlay kind, and series-builder branch are wired correctly. Two issues remain that make the MACD overlay invisible.

## Bug 1 — `multi` panel overlays are sent to the PRICE chart

`src/components/charts/LightweightVisualizeChart.tsx` splits overlays by `kind === "panel"`:

```text
panelOverlays = overlays.filter(o => o.kind === "panel")
priceOverlays = overlays.filter(o => o.kind !== "panel")
```

MACD is `{ kind: "multi", pane: "panel" }`, so it falls into `priceOverlays`. It gets added to the price chart whose range is dominated by candle prices (0–10 on the screenshot). MACD values (~0.005) render as a flat line glued to the bottom axis — effectively invisible.

**Fix:** route multi overlays by their `pane` field.

```text
const isPanel = (o) =>
  o.kind === "panel" || (o.kind === "multi" && o.pane === "panel");
const panelOverlays = overlays.filter(isPanel);
const priceOverlays = overlays.filter((o) => !isPanel(o));
```

No other change needed there; the panel chart is auto-created when `panelOverlays.length > 0`.

## Bug 2 — time fallback breaks alignment for indicator rows without `time`

MACD historical rows are `{ macd, signal, histogram }` with no `time`. In `VisualizeNodePreview.tsx > readTime`, the fallback returns the row index (0, 1, 2, …). Then `buildSeriesPoints` produces `[{time:0,value:0.004}, {time:1,value:0.005}, …]` and we pass that to `alignSeriesToCandles`.

`alignSeriesToCandles` only does tail-alignment when **every** element is a finite number (`allNumeric`). With objects present it takes the time-map path, looks up `byTime.get(candle.time)` where candle times are huge UTC seconds → every lookup misses → all values become `null` → nothing draws.

**Fix:** in the registry path, extract each channel as a **plain `number[]`** when rows have no real time field, and let `alignSeriesToCandles` tail-align it (same behavior already used for numeric arrays like RSI). Use the time-bearing path only when rows actually carry a timestamp.

In `VisualizeNodePreview.tsx`:

```text
const rowsHaveTime = seriesRows.some(
  (r) => typeof r === "object" && r !== null &&
    ((r as any).time ?? (r as any).t ?? (r as any).timestamp) !== undefined
);

const buildChannelInput = (key: string) =>
  rowsHaveTime
    ? buildSeriesPoints(seriesRows, key)     // {time, value}[]
    : seriesRows.map((r) => readNumeric(r, key)); // number[] (nulls coerced to NaN)
```

Then pass that to `alignSeriesToCandles`. For the `number[]` path, drop `null` entries or substitute `NaN` so `allNumeric` stays true and tail-alignment kicks in. Apply the same fix to the `bands` branch (so BB rows without time still work) and keep the existing `levels` branch unchanged.

## Verification

1. Drag `{{ $('MACD').json.data }}`, Indicator = MACD → a second panel appears under the candle chart with blue MACD line, dashed orange Signal line, and purple Histogram bars. Price chart range stays focused on candles.
2. RSI with Indicator = RSI → panel with line + dashed 30/70 levels; price chart unaffected.
3. BB with Indicator = Bollinger Bands → 3 lines on price (regression).
4. Support & Resistance with Indicator = Support & Resistance → 3 green + 3 red dashed price lines (regression).
5. Indicator = Auto on any row → existing classifier path still works.

## Files to change

- `src/components/charts/LightweightVisualizeChart.tsx` — route multi overlays by `pane`.
- `src/components/nodes/visualize/VisualizeNodePreview.tsx` — when rows lack `time`, feed `number[]` per channel into `alignSeriesToCandles`.

## Out of scope

Registry contents, dropdown options, chartTypes, series builder, backend.
