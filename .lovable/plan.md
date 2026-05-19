# Fix legend: drop right-axis tags, keep crosshair values

Two follow-ups on the top-left pane legends.

## Problem

1. **Stale right-axis tags.** The colored "Overlay 1 ADX / +DI / -DI" labels on the right edge of each panel are still drawn by lightweight-charts. They duplicate the new top-left legend and need to go.
2. **Crosshair values blink and snap back.** Moving the cursor over the ADX line briefly shows the hovered value, then immediately resets to the last-bar value. The legend never tracks the cursor.

## Root causes

1. The series `title` option (e.g. `"Overlay 1 ADX"`) renders an axis label on the price scale. `lastValueVisible: false` only hides the numeric last-value badge; the title chip is still drawn whenever `title` is set. Need to stop passing `title` for overlay series (we already have a dedicated top-left legend that shows the name).
2. In `LightweightVisualizeChart.tsx` the data/overlay reconciliation `useEffect` lists `priceLegendOverlays` in its dependency array, but that array is built inline (`priceOverlays.filter(...)`) on every render with no `useMemo`. Every time the crosshair handler calls `setLegendState`, the component re-renders, a new `priceLegendOverlays` reference is produced, the effect re-runs, and the effect's final `setLegendState({ ...last-bar values ... })` overwrites the hovered values. Result: crosshair value flashes for one frame, then snaps back.

## Changes

### 1. `src/components/charts/lightweightSeriesBuilder.ts`

Stop passing `title` on every overlay series (`line/panel`, `multi` channels, `bands` upper/middle/lower, `levels` support/resistance series). The top-left legend already labels them. Keep `lastValueVisible: false` and `priceLineVisible: false` as today. Reference-line `createPriceLine` calls keep their `title` because those are real horizontal levels the user wants labeled (e.g. RSI 30 / 70).

### 2. `src/components/charts/LightweightVisualizeChart.tsx`

- Wrap `priceLegendOverlays` in `useMemo(() => priceOverlays.filter(o => o.kind !== "levels"), [priceOverlays])` so its identity is stable across crosshair-driven re-renders.
- Double-check the effect deps: `viewModel`, `panelOverlays`, `priceLegendOverlays`, `priceOverlays` are all memoized now, so the effect only re-runs when overlays/data actually change.
- No change to the crosshair handler itself — once the effect stops re-firing per render, hovered values stick.

### 3. Build errors in the same file

- Replace `ISeriesApiBase` import (doesn't exist in this version of `lightweight-charts`) with `ISeriesApi` and cast the series to `ISeriesApi<"Line" | "Histogram", Time>` when calling `param.seriesData.get(...)`.
- Replace the four `arr.findLast(...)` calls in `buildOverlayLastValues` with a small helper `lastValid(points)` that scans from the end with a `for` loop — avoids needing `lib: es2023`.

## Verification

- Open Visualize with ADX panel → right edge of the panel no longer shows the three colored chips. Only the price-axis numbers remain.
- Hover the ADX line → the top-left legend's `ADX / +DI / -DI` numbers track the cursor smoothly and stay on the hovered bar's values.
- Move cursor off the chart → legend snaps back to the latest bar.
- Add/remove an overlay → reconciliation still happens (legend updates, panes appear/disappear).
- Reference levels (RSI 30/70, etc.) keep their axis labels.
