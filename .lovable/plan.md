# Render each panel indicator in its own pane

## Problem

In the Visualize node, every overlay whose pane is `panel` (RSI, ADX, MACD, Stochastic, OBV, Volume Oscillator, etc.) is drawn into **one shared sub-chart**. With two panel indicators active (image 1: ADX + RSI), their series and reference lines (RSI 30/70, ADX +DI/-DI) overlap on the same axis, scales are incompatible, and the legend numbers mix together.

Industry-standard charts (image 2: Investing.com) give each panel indicator its own horizontal pane stacked under the price chart with a shared time axis.

## Proposed change

Switch `src/components/charts/LightweightVisualizeChart.tsx` from "one panel chart" to "one panel chart per panel overlay":

1. Replace the single `panelChartRef` / `panelRef` with a keyed map of `{ overlayId -> { container, chart, handles } }`.
2. Render one `<div>` per panel overlay below the price chart, each with its own `createChart` instance at `PANEL_HEIGHT` (~140px). Order follows `panelOverlays` order.
3. Sync every panel chart's visible logical range with the price chart (extend `syncTimeScales` to an N-way sync helper: when any chart's range changes, propagate to all others with a single re-entrancy guard).
4. Reconciliation:
   - If a panel overlay is added → create a new chart instance for it.
   - If removed → tear down its chart, unsubscribe from sync, drop the container.
   - If data changes → call `addOverlaySeries` on that overlay's own chart (no other overlays share it).
5. Update `OverlayRegistry` from `{ price, panel }` to `{ price: Map, panels: Map<overlayId, { chart, handles }> }`.
6. Cleanup on unmount: iterate all panel charts, remove series, call `chart.remove()`.
7. Resize observer: extend to resize every panel container on width change.

## Out of scope

- Price-pane overlays (EMA, SMA, BB, VWAP, Ichimoku, S/R) keep rendering on the candlestick chart — that's already correct.
- No change to `lightweightSeriesBuilder.ts`, `chartTypes.ts`, `visualizeNormalize.ts`, or the Visualize node JSON.
- No change to per-overlay color/legend logic; once each indicator owns its pane the legend collisions disappear naturally.

## Verification

- Configure Visualize with overlays RSI + ADX (image 1 scenario) → two separate panels appear under the candles; RSI shows only `RSI`, `RSI 30`, `RSI 70`; ADX shows only `ADX`, `+DI`, `-DI`.
- Add a third panel (MACD) → third pane stacked below, time-axis stays in lock-step when panning/zooming any pane.
- Remove an overlay → its pane disappears, others remain aligned.
- Resize the node → all panes resize together.
- Switch to a workflow with only price overlays (EMA + BB) → no panel area rendered, layout unchanged from today.
