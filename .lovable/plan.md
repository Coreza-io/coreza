# Support & Resistance overlay not visible — root cause and fix

## Why it does not render

The classifier and S&R data flow are correct. Verified end-to-end:

1. `{{ $('Support & Resistance').json.data }}` resolves (pure template) to the array `[{ pivot, support: [...], resistance: [...] }]`.
2. `classifyOverlay` with render = "Levels" returns `{ kind: "levels", supports: [0.2202, 0.2072, 0.1993], resistances: [0.2411, 0.2489, 0.2619] }` (covered by the existing test "detects levels from latest summary row in array payload").
3. `VisualizeNodePreview` pushes a `levels` overlay with `currentClose` = last candle close.

The bug lives in `src/components/charts/lightweightSeriesBuilder.ts` inside `addOverlaySeries`:

```text
const anchor = chart.addSeries(LineSeries, { color: "transparent", lineVisible: false, ... });
anchor.setData([]);                       // <-- empty
nearestLevels(...).forEach((price) => anchor.createPriceLine({ price, ... }));
```

`createPriceLine` is attached to a transparent `LineSeries` that has **no data**. In `lightweight-charts`, a series with `setData([])` has no auto price scale range, so the price lines bound to it either render outside the visible price range or get culled. That is why only stray axis labels appear (the few that happen to land in the volume scale range) and no horizontal lines show up over the candles.

BB renders correctly because bands use real `LineSeries.setData(...)` per upper/middle/lower — never `createPriceLine`.

## Fix

Attach the price lines to a series that already participates in the price scale — the candlestick series. Concretely:

1. **`src/components/charts/lightweightSeriesBuilder.ts`**
   - Change `addOverlaySeries(chart, overlay)` to `addOverlaySeries(chart, overlay, priceAnchor?)` where `priceAnchor` is `ISeriesApi<'Candlestick' | 'Line', Time>` from the host chart.
   - In the `levels` branch, call `priceAnchor.createPriceLine(...)` instead of creating an internal transparent series. Drop the `anchor` series entirely.
   - If `priceAnchor` is not supplied (defensive), fall back to creating a small `LineSeries` seeded with two dummy points at the candle time range using one of the supports/resistances values so the scale is initialized.

2. **`src/components/charts/LightweightVisualizeChart.tsx`**
   - In the data effect, pass `candleSeriesRef.current` as the third argument when calling `addOverlaySeries(priceChart, overlay, candleSeriesRef.current)`.
   - For panel overlays (oscillators) leave the call signature as today (no price anchor — panel overlays never use levels).

3. **No other files need changes.** Existing `nearestLevels` logic, colors, and titles are preserved.

## "How does the chart know where to mark a level?"

Support and resistance levels are **horizontal price values** — they apply across the entire chart, not at a specific bar. The library's `createPriceLine` is built for exactly this: it draws a full-width horizontal line at a given price with an axis label on the right.

You do **not** need timestamps for the standard "level" use case. Timestamps would only matter if you wanted to render a level as a partial segment (e.g. "this resistance was valid only between bar 50 and bar 80"). The existing data shape already supports that via `supportSeries` / `resistanceSeries` (parsed from `{ type, level, time }` entries), and those keep using real `LineSeries.setData(...)`, so they will continue to plot as time-bounded segments when provided.

Summary:
- Plain numeric arrays (current S&R payload) → full-width horizontal price lines via `createPriceLine` on the candle series.
- Time-stamped level entries → segmented `LineSeries` already handled.

## Verification

1. With current S&R payload (`[{ pivot, support: [...], resistance: [...] }]`) and render = Levels: three green dashed support lines around 0.220 / 0.207 / 0.199 and three red dashed resistance lines around 0.241 / 0.249 / 0.262, each with a colored price label on the right axis.
2. BB overlay still renders as bands (regression).
3. Removing the S&R overlay row removes the lines cleanly (no orphan price lines).
4. Switching render from Levels back to Auto still produces the same levels output (classifier already handles both).

## Out of scope

`VisualizeNodePreview`, `visualizeNormalize.ts`, drag/drop hooks, repeater layout, and backend.
