# Investing.com-style pane legends

## Goal

Show each indicator's name and live value(s) as a small overlay in the **top-left of its pane**, matching the Investing.com layout:

- Price pane: `Ichimoku  0.2297  0.2998  0.2290  0.2723  0.3430` (one number per channel, color-matched)
- Each panel pane: `RSI (14)  42.40`, `ADX (14)  13.18  +DI 22.02  -DI 26.12`, `Volume  4.64M`, etc.
- When the user moves the crosshair, the numbers update to that bar's values. With no crosshair, show the latest bar.

The numbers stay tied to the pane they belong to — no more mixing.

## Changes

### 1. New component `src/components/charts/ChartPaneLegend.tsx`

A small presentational overlay:

- Absolutely positioned `top-2 left-2`, `pointer-events-none`, semi-transparent background, monospace numbers, small text.
- Props: `overlays: VisualizeOverlay[]`, `values: Record<overlayId, Record<channelKey, number | null>>`.
- Renders one row per overlay: name (e.g. `RSI`, `ADX`, `Bollinger Bands`), then a chip per channel `[●] label  value` using the overlay's color from `indicatorRegistry` / overlay definition.
- Number formatter: volume-like values (≥ 1000) → `1.23K / 4.64M / 1.2B`; otherwise fixed 2-4 decimals based on magnitude.

### 2. `src/components/charts/lightweightSeriesBuilder.ts`

Extend `OverlayHandles` with a `channels: Array<{ key: string; label: string; color: string; series: ISeriesApi<...> }>` map so the chart component can resolve "which series renders which channel" without inspecting JSON. Populate it in all three branches (`line/panel`, `multi`, `bands` → upper/middle/lower, `levels` → support/resistance series). Existing `series` / `priceLines` arrays stay unchanged for cleanup.

### 3. `src/components/charts/LightweightVisualizeChart.tsx`

- Wrap the price chart container and each panel container in a `relative` div and mount `<ChartPaneLegend>` inside it.
- Track legend state with `useState<Record<paneKey, Record<overlayId, Record<channelKey, number | null>>>>`.
- On data apply: seed each channel's value with the **last** non-null point.
- Subscribe to `chart.subscribeCrosshairMove` on every chart (price + each panel). When a `param.time` is provided, look up `param.seriesData.get(series)` for each tracked channel series and update the legend state for that pane. When the crosshair leaves (`param.time` is undefined), revert to the last-bar values.
- Unsubscribe on chart teardown alongside the existing sync/registry cleanup.
- Price-pane legend includes the candle OHLC summary (optional, small) — keep this minimal so it doesn't clash with overlays.

### 4. No changes needed

- `chartTypes.ts`, `visualizeNormalize.ts`, `indicatorRegistry.ts`, the Visualize node JSON, or any backend code. Colors and labels already flow through `VisualizeOverlay`.

## Verification

- Open Visualize with RSI + ADX → each panel shows its own legend in the top-left with the correct values; numbers update as you hover candles.
- Add MACD → third panel shows `MACD  macd  signal  histogram` colored to match the series.
- Add Bollinger + EMA on price → price-pane legend lists both with current values.
- Hover off the chart → legend snaps back to the last bar's values.
- Resize the node → legends stay pinned to the top-left of their pane.
- Workflow with no overlays → only the candle OHLC mini-legend appears (or nothing if we opt out).
