# Visualize node — chart stays blank because `priceRef.current` is null

## Confirmed symptom

- `viewModel.candles.length === 594` (data resolves correctly).
- At the chart return statement, `priceRef.current === null`.
- Result: chart container is rendered, but the Lightweight Charts instance was never created, so the area stays empty.

## Root cause (precise)

`LightweightVisualizeChart.tsx` has this exact ordering problem:

1. First render — `fieldState.candles` is still empty, so `viewModel.candles.length === 0`. The component takes the early-return branch:
   ```tsx
   if (viewModel.candles.length === 0) {
     return <div>No candle data</div>;
   }
   ```
   The chart container `<div ref={priceRef} />` is never rendered, so `priceRef.current` stays `null`.

2. The init effect runs once on mount with an empty dependency array:
   ```tsx
   useEffect(() => {
     if (!priceRef.current || priceChartRef.current) return; // ← bails out, ref is null
     // createChart(...) never reached
   }, []);
   ```
   Because `priceRef.current` is null at that moment, the effect bails immediately. It will never run again — `[]` deps.

3. User drops Candle Data → `viewModel.candles.length` becomes 594 → component re-renders the chart container → `priceRef.current` is now a real div. But the init effect does not re-run, so `priceChartRef.current` is still `null`. The data-update effect then bails on its own guard:
   ```tsx
   if (!priceChart || !candleSeries || !volumeSeries) return;
   ```
   Net effect: chart container exists, but no Lightweight Charts instance was ever created. Permanent blank chart.

This is exactly the state shown in the screenshots: `candles = 594`, `current = null`.

## Fix — always mount the chart container, gate only the empty message

Change `LightweightVisualizeChart.tsx` so the chart container is rendered on every render (so `priceRef` always attaches), and the "No candle data" hint becomes an overlay/sibling instead of an early return.

Implementation details:

1. Remove the early `if (viewModel.candles.length === 0) return ...` branch.
2. Always render:
   ```tsx
   return (
     <div className="space-y-2 relative">
       <div ref={priceRef} className="w-full" style={{ height: PRICE_HEIGHT }} />
       {panelOverlays.length > 0 && (
         <div ref={panelRef} className="w-full" style={{ height: PANEL_HEIGHT }} />
       )}
       {viewModel.candles.length === 0 && (
         <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
           No candle data
         </div>
       )}
     </div>
   );
   ```
   Explicit `height` on the container guarantees a non-zero box for Lightweight Charts to lay out into; `w-full` alone can give 0 height on some parent layouts.
3. The init effect can stay as-is (`[]` deps) — once the container is always present, `priceRef.current` is non-null on mount and `createChart(...)` runs.
4. The data-update effect already depends on `viewModel`, so when candles arrive it will `setData(...)` on the existing series.

That single change is the minimum required to make the chart render.

## Secondary fix — Lightweight Charts v5 overlay series API

Once candles render, the next user step is adding overlays (BB, oscillator, S/R). The project uses `lightweight-charts@5.2.0`, but `src/components/charts/lightweightSeriesBuilder.ts` still calls `chart.addLineSeries(...)`, which does not exist in v5. Overlays would silently throw the moment a row is added.

Update `lightweightSeriesBuilder.ts`:

- Import `LineSeries` from `lightweight-charts`.
- Replace every `chart.addLineSeries(options)` with `chart.addSeries(LineSeries, options)`.
- Update the local `ChartApi` type accordingly so the helper compiles. Keep the rest of the logic unchanged (line / bands / levels / panel still return arrays of series for cleanup).

## Out of scope

- No backend changes.
- No change to `Visualize.json`, `chartTypes.ts`, the normalizer, or `RepeaterNodeLayout` (overlays repeater, preview resolution wiring, and Execute-hidden behavior remain as currently implemented).

## Verification

1. Open Visualize, connect Alpaca, drop `BarSeries[0].bars` into Candle Data. Candlestick chart + volume histogram render immediately.
2. With Candle Data still empty, the area shows "No candle data" overlaid on a sized chart container (no layout jump when data arrives).
3. Add a BB overlay row, drop BB data — upper/middle/lower lines appear on the price pane.
4. Add an oscillator overlay row — second panel renders below with synced time scale.
5. Remove an overlay row — its series disappears without remounting the chart.
