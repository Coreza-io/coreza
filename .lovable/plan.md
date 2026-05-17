# S&R duplicate lines + label clutter — root cause and fix

## Root cause 1 — duplicate price lines (why you see 6 instead of 3)

The data is correct (3 supports + 3 resistances). The chart accumulates them on every re-render.

In `src/components/charts/lightweightSeriesBuilder.ts` the `levels` branch now attaches `createPriceLine(...)` to the candlestick series (`priceAnchor`). That fixed visibility, but introduced a leak:

- `LightweightVisualizeChart` reconciles overlays by removing the previous `ISeriesApi<"Line">[]` returned for that overlay id and calling `addOverlaySeries` again.
- `removeSeries(...)` removes only the Line series in that list. **Price lines attached to the candlestick series are NOT tracked in that list**, so they survive.
- Every re-render (debounced field edit, viewport change, parent re-render) appends another 3 supports + 3 resistances onto the candle series. After 2 cycles you see 6/6, after 3 you would see 9/9.

The currentClose filter in `nearestLevels` further means as the closing price drifts, some lines change side but the old ones never disappear, which is what produces the visible mix of stale label values.

## Root cause 2 — label clutter blocks the chart

`createPriceLine` is currently called with `title: "${overlay.name} support"` and `axisLabelVisible: true`. Each price line renders both:
- a colored axis label on the right (price value), and
- a colored badge with the title text drawn on top of the chart area.

With 6 supports + 6 resistances stacked tightly, the title badges cover the candles and the BB lines.

## Fix

Make these changes only in `src/components/charts/lightweightSeriesBuilder.ts` and `src/components/charts/LightweightVisualizeChart.tsx`. No other files touched.

### 1. Track and remove price lines per overlay

`src/components/charts/lightweightSeriesBuilder.ts`
- Change the return type of `addOverlaySeries` from `ISeriesApi<"Line", Time>[]` to a richer record, e.g.:
  ```text
  type OverlayHandles = {
    series: ISeriesApi<"Line", Time>[];
    priceLines: Array<{ anchor: ISeriesApi<any, Time>; line: IPriceLine }>;
  };
  ```
- In the `levels` branch, capture the return value of each `priceAnchor.createPriceLine(...)` call and push `{ anchor: priceAnchor, line }` into `priceLines`.
- Other branches (`line`, `bands`, `panel`) return `priceLines: []`.

`src/components/charts/LightweightVisualizeChart.tsx`
- Change the `OverlayRegistry` value type from `ISeriesApi<"Line", Time>[]` to `OverlayHandles`.
- Update `removeSeriesList` (or add a sibling helper) to also call `handles.priceLines.forEach(({ anchor, line }) => anchor.removePriceLine(line))` before removing the line series.
- Apply this in both reconciliation paths (active id no longer present, and same id re-added).

### 2. Clean up labels

In the `levels` branch of `addOverlaySeries`:
- Drop the `title` from `createPriceLine` (or set it to an empty string) so the on-chart text badge disappears. The colored axis label on the right keeps the price value visible, which is the useful information.
- Keep `axisLabelVisible: true`, dashed style, width 1.

Result: chart shows clean horizontal dashed lines (green = support, red = resistance) with only a price value on the right axis. No overlapping "Overlay 1 support" / "Overlay 1 resistance" badges over the candles.

## "How does the chart know where to mark a level?"

Supports and resistances are price values that apply across the entire chart, not at a specific bar. `createPriceLine` draws a full-width horizontal line at that price plus a single label on the price axis. Timestamps are not needed for plain numeric levels. Time-bounded segments (rare) are still handled by the existing `supportSeries` / `resistanceSeries` branch when entries include `time`.

## Verification

1. Open the Visualize node with the current S&R payload. Expect exactly 3 green dashed lines (0.220 / 0.207 / 0.199) and 3 red dashed lines (0.241 / 0.249 / 0.262), with price-only labels on the right axis.
2. Edit any field on the node to force re-render. Line count must stay at 3 + 3, not grow.
3. Remove the S&R overlay row. Both lines and price-axis labels must disappear cleanly.
4. BB band overlay continues to render upper/middle/lower lines (regression).
5. Switching render between Auto and Levels keeps the same 3 + 3 output.

## Out of scope

`VisualizeNodePreview`, `visualizeNormalize.ts`, drag-and-drop hooks, repeater layout, backend.
