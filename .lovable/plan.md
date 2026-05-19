# Fix: chart blank when node is expanded before data arrives

## Root cause

`LightweightVisualizeChart` has two effects:

1. **Init effect** (mount-only, deps `[]`) — creates the price chart, retrying via `requestAnimationFrame` until the container has a non-zero width. On success it inlines `applyData()` for candles/volume but does **not** add overlays.
2. **Data reconciliation effect** (deps `[viewModel, priceOverlays, panelOverlays, ...]`) — sets candle/volume data and reconciles overlays. The first line is an early-return guard: `if (!priceChart || !candleSeries || !volumeSeries) return;`.

Failure sequence the user is hitting:

1. User expands the empty Visualize node. Init effect starts rAF-polling because container width is still 0 during the expand transition.
2. User connects ADX. `viewModel` updates → data effect fires → `priceChartRef.current` is still `null` → effect returns early and is never re-queued.
3. Some time later the container reaches a non-zero width, init effect creates the chart, calls `applyData()` (candles/volume only — but candles are empty so still nothing visible), but **overlays are never added** because the data effect has no signal to re-run.
4. Any later change (toggling, reconnecting, editing fields) bumps `viewModel`, the data effect fires again, sees the chart exists now, and renders everything. That's why "reconnecting makes it appear".

## Fix

Make the data effect re-run once the chart finishes initializing.

### `src/components/charts/LightweightVisualizeChart.tsx`

1. Add a `const [chartReady, setChartReady] = useState(false);` state.
2. In the init effect, right after assigning `priceChartRef.current = priceChart`, call `setChartReady(true)`. Remove the `queueMicrotask(() => applyData())` shim — the data effect will handle it.
3. In the init effect's cleanup, also `setChartReady(false)` so a remount starts clean.
4. Add `chartReady` to the data effect's dependency array so it re-runs as soon as the chart exists.
5. Keep the early-return guard as a safety net.

That's the whole change — no other files touched.

### Verification

- Collapse a Visualize node, populate ADX upstream, expand the node → chart and ADX panel render immediately.
- Expand an empty Visualize node, then connect ADX → chart renders as soon as data flows, without needing to reconnect.
- Existing flow (expand with data already present) still works.
- Crosshair, OHLC hover, wheel/pinch zoom isolation, top-left legend — all unchanged.
