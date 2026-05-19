# Make price OHLC track the crosshair

The pane indicators (RSI, ADX, MACD, etc.) now update correctly as the cursor moves across bars. The price pane's `O / H / L / C` header still shows the last bar's values and never updates on hover.

## Root cause

In `LightweightVisualizeChart.tsx` the price legend's `ohlc` prop is built from `latestCandle = viewModel.candles[viewModel.candles.length - 1]` only. The crosshair handler `bindCrosshairLegend` updates `legendState` for overlay channels but does not write the candle's OHLC anywhere, so the header stays pinned to the last bar.

## Change

### `src/components/charts/LightweightVisualizeChart.tsx`

1. Add a second piece of state alongside `legendState`:
   ```ts
   const [hoveredOhlc, setHoveredOhlc] = useState<OhlcValues | null>(null);
   ```
   Type imported from `ChartPaneLegend` (or redeclared locally with the same shape).

2. In the price-chart crosshair handler (the one bound with `paneKey === "price"`), in addition to updating overlay channel values, look up the candle bar for that timestamp:
   ```ts
   const candleData = param.seriesData.get(candleSeriesRef.current!);
   if (param.time !== undefined && candleData && "open" in candleData) {
     setHoveredOhlc({
       open: candleData.open,
       high: candleData.high,
       low: candleData.low,
       close: candleData.close,
     });
   } else {
     setHoveredOhlc(null);
   }
   ```
   The candle series is already available via `candleSeriesRef.current`; pass it into `bindCrosshairLegend` for the price pane (or special-case the price pane inline) so the handler can read the hovered candle each move.

3. Render the legend with the hovered value when present, falling back to the latest bar:
   ```tsx
   ohlc={hoveredOhlc ?? (latestCandle ? { open, high, low, close } : null)}
   ```

4. No changes needed to `ChartPaneLegend.tsx` — its `ohlc` prop already accepts any `OhlcValues` and re-renders on change.

5. Tear-down: nothing extra needed; the existing crosshair unsubscribe in the unmount cleanup already covers this handler.

## Verification

- Open Visualize with candles → top-left shows `O / H / L / C` for the last bar.
- Move cursor across the price chart → those four numbers update bar-by-bar to match the hovered candle.
- Move cursor off the chart → numbers snap back to the last bar.
- Indicator panels keep working exactly as before.
