# Visualize node chart still blank

## What is actually happening

The Candle Data path is working now:

- The field preview shows the Alpaca bars.
- `VisualizeNodePreview` is creating a `viewModel` with candles.
- `LightweightVisualizeChart` is receiving that `viewModel`.
- Your debugger shows `priceRef.current` is a real DOM element with `clientWidth = 545` and `clientHeight = 320`.

So this is no longer a candle parsing problem and no longer the old `priceRef.current === null` problem.

## Do I know what the issue is?

Yes. The most likely blocker is inside the chart lifecycle and node layout, not backend execution.

There are two concrete issues to fix:

1. `RepeaterNodeLayout.tsx` is responsible for placing the chart preview. The chart must remain inside the Visualize node's visible form stack, directly after the Overlays controls, so it cannot be hidden outside the visible field layout.
2. `LightweightVisualizeChart.tsx` currently creates the chart once in a mount-only effect, then sets data in a separate effect. In React 18 StrictMode and React Flow expanded/collapsed layouts, this is fragile because the chart can be created/removed during lifecycle transitions while refs still point to stale chart objects. The data effect can then run before a valid chart/series set exists or after cleanup.

There is also a separate TypeScript issue in `lightweightSeriesBuilder.ts` around Lightweight Charts v5 `Time` typing.

## Implementation plan

### 1. Make the chart preview placement explicit in `RepeaterNodeLayout.tsx`

- Keep the Visualize preview inside the `<form className="space-y-3">` stack.
- Render it after the repeater section and before dependency/submit/error controls.
- Wrap it in a visible container with a stable minimum height, e.g. `min-h-[320px]`, so the React Flow node reserves space for the chart.
- Do not re-add the Execute button for Visualize.

### 2. Harden `LightweightVisualizeChart.tsx` lifecycle

- Combine chart creation and first data application into the initialization effect, or call a shared `applyChartData()` immediately after series creation.
- Reset all refs to `null` during cleanup:
  - `priceChartRef`
  - `panelChartRef`
  - `candleSeriesRef`
  - `volumeSeriesRef`
  - `cleanupSyncRef`
- Add a lightweight guard so chart creation waits for a non-zero container width.
- Keep the chart container always rendered with explicit height.
- Keep `No candle data` as an overlay only when candles are empty.

This makes the component resilient when React StrictMode mounts/unmounts once during development and when React Flow changes expanded layout.

### 3. Fix Lightweight Charts v5 typing in `lightweightSeriesBuilder.ts`

- Ensure every line-series point uses `time: Time`, not raw `number`.
- `toLineData()` already has the right shape in the current file; keep that pattern and ensure no raw number arrays are passed to `setData`.

### 4. Optional only if still visually clipped

If the chart appears but is cramped/clipped, increase `src/nodes/Visualize.json` height from `540` to around `820`.

## Verification

1. Open Visualize node.
2. Confirm Candle Data preview still shows Alpaca bars.
3. Confirm the chart area appears directly below Overlays.
4. Confirm candlestick + volume render without pressing Execute.
5. Add an overlay and confirm no Lightweight Charts v5 errors appear.

## Out of scope

- No backend changes.
- No candle normalizer changes.
- No executor changes.
- No data schema changes.