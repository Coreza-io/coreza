# Visualize node — fix blank chart after Candle Data is populated

## Current symptom

The Candle Data field is filled correctly and the floating preview resolves to a real array of bars, but the chart area stays blank instead of creating a Lightweight Charts candlestick chart.

## Root cause

`LightweightVisualizeChart` starts with no candles, so it renders this branch:

```tsx
if (viewModel.candles.length === 0) {
  return <div>No candle data</div>;
}
```

Because that branch does not render the `priceRef` chart container, the chart setup effect runs once, sees `priceRef.current === null`, and exits:

```tsx
useEffect(() => {
  if (!priceRef.current || priceChartRef.current) return;
  // create chart...
}, []);
```

Later, when the user drops Candle Data and `viewModel.candles` becomes non-empty, React renders the chart container, but the setup effect has already run and will not run again because its dependency array is empty. The update effect then also exits because `priceChartRef.current` was never created.

That creates a permanent blank chart area even though the candle data is valid.

## Fix 1 — create the chart when candles become available

Update `src/components/charts/LightweightVisualizeChart.tsx` so the chart initialization effect can run after the empty state changes to real candle data.

Implementation details:

- Add `viewModel.candles.length` to the chart initialization effect dependency list.
- Keep the existing guard `if (!priceRef.current || priceChartRef.current) return;` so the chart is created only once.
- When `viewModel.candles.length === 0`, show the empty state as before.
- When candles become non-empty, the container is rendered, the effect reruns, and `createChart(...)` initializes the candlestick/volume chart.

## Fix 2 — make the chart container layout stable

The chart container currently has only `w-full`. To avoid a zero-height or visually collapsed chart while Lightweight Charts initializes, give it stable dimensions.

Implementation details:

- Change the price chart container to a fixed chart height matching `PRICE_HEIGHT`, for example:
  ```tsx
  <div ref={priceRef} className="w-full" style={{ height: PRICE_HEIGHT }} />
  ```
- Do the same for the oscillator panel container with `PANEL_HEIGHT`.
- Keep the chart options height values unchanged.

## Fix 3 — pass React Flow nodes into Visualize reference resolution

`resolveReferences` supports display-name/id fallback through the optional `nodes` argument. `VisualizeNodePreview` currently receives `sourceData` and `allNodeData`, but not `nodes`.

Implementation details:

- In `RepeaterNodeLayout`, pass `nodes={getNodes()}` or a memoized current node list to `VisualizeNodePreview`.
- In `VisualizeNodePreview`, add a `nodes` prop and call:
  ```ts
  resolveReferences(expr, sourceData, allNodeData, nodes)
  ```
- This makes Visualize resolution match the normal field preview path in `useNodeReferences`.

## Fix 4 — update overlay series creation for Lightweight Charts v5

`lightweightSeriesBuilder.ts` still assumes the older `chart.addLineSeries(...)` API. The project uses `lightweight-charts@5.2.0`, so overlays may fail as soon as a BB / support-resistance / oscillator row is added.

Implementation details:

- Import `LineSeries` from `lightweight-charts`.
- Replace `chart.addLineSeries(options)` with `chart.addSeries(LineSeries, options)`.
- Keep the existing overlay behavior unchanged: line, bands, levels, and panel all still return series lists for cleanup.

## Verification checklist

1. Open Visualize connected to Alpaca.
2. Drop `BarSeries[0].bars` into Candle Data.
3. Candlestick + volume chart appears immediately without clicking Execute.
4. The Output panel does not need to change for the chart to render.
5. Add a BB overlay row and drop BB data into Data: upper/middle/lower lines render on the price chart.
6. Add an oscillator overlay row: a second panel appears under the price chart.
7. Remove an overlay row: its series disappears cleanly.

## Out of scope

- No backend changes.
- No change to `Visualize.json` fields.
- No change to candle/indicator normalization logic unless a specific input shape is still not recognized after the chart initialization fix.
