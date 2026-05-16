# Visualize node — fix runtime crash + missing fields + TS build errors

## Problem 1 (runtime crash, blocks the node from opening)

`TypeError: Cannot read properties of undefined (reading 'Alpaca')` at `RepeaterNodeLayout.tsx:69`.

### Root cause

In the previous fix, Visualize was routed to `RepeaterNodeLayout` so its `overlays` repeater would render. `RepeaterNodeLayout` then tries to compute `selectedInputData` locally with:

```ts
const executionStore = useExecutionStore();
const getNodeExecutionOutput = (nodeId) => executionStore.executionOutput[nodeId] || null;
```

But `useExecutionStore()` returns an `ExecutionContext` instance (`src/utils/executionContext.ts`) — it has no `executionOutput` property. Reading `.executionOutput` is `undefined`, then indexing by node id (e.g. the upstream "Alpaca" node id) throws.

This bug was latent before — no repeater-routed node previously had upstream node data accessed via this path. Visualize is the first one to hit it.

### Fix

`selectedInputData` is **already passed as a prop** from `BaseNode` → `NodeRouter` → `RepeaterNodeLayout` (via `BaseNodeRenderProps`, see `BaseNode.tsx` line 170 and 205). Stop recomputing it.

- **`src/components/nodes/layout/RepeaterNodeLayout.tsx`** —
  - Add `selectedInputData` to the destructured props.
  - Delete the local `useMemo` block (lines ~62–91) including the `useExecutionStore`, `getNodes`, and `getDisplayName` usage for this purpose.
  - Drop the now-unused imports (`useExecutionStore`, `useReactFlow`, `getDisplayName`) if nothing else in the file uses them; otherwise leave them.

## Problem 2 (no fields visible — already covered, restate)

Two layered issues prevented Candle Data input and Overlays repeater from rendering:

1. **`NodeRouter.tsx`** short-circuited Visualize to `"basic"` layout, bypassing repeater detection.
2. **`BasicNodeLayout.tsx`** gated the entire fields `<form>` behind `{!isVisualize && ...}`.

### Fix (already applied; keep)

- `NodeRouter.tsx` — remove the Visualize → basic short-circuit so the existing `hasRepeaterFields` check routes it to `"repeater"`.
- `RepeaterNodeLayout.tsx` — render `<VisualizeNodePreview fieldState={fieldState} selectedInputData={selectedInputData} />` after the fields/repeater section when `definition.name === "Visualize"`.
- `BasicNodeLayout.tsx` — remove the `isVisualize` branch and revert to generic.

## Problem 3 (TypeScript build errors)

`lightweight-charts@^5.2.0` API differs from v4 the code was written against.

### Fixes in `src/components/charts/LightweightVisualizeChart.tsx`

- v5 removed `chart.addCandlestickSeries()` / `chart.addHistogramSeries()`. Use `chart.addSeries(CandlestickSeries, options)` and `chart.addSeries(HistogramSeries, options)` — import `CandlestickSeries` and `HistogramSeries` from `lightweight-charts`.
- `subscribeVisibleLogicalRangeChange` handler signature is `(range: LogicalRange | null) => void`. The `fromFirst`/`fromSecond` callbacks currently mistype `range` as the return type of `getVisibleLogicalRange` (a function). Import `LogicalRange` from `lightweight-charts` and type the parameter as `LogicalRange | null`.
- Histogram data `time` must be typed as `Time`, not raw `number`. Cast each `time` to `Time` in `toVolumeData` (same pattern already used for candle mapping).

### Fixes in `src/utils/visualizeNormalize.ts`

Lines 193 and 198 build `{ kind: "levels", ... }` literals without an `as OverlayClassification` assertion, so TS widens `kind` to `string`. Add `as OverlayClassification` (or `as const` on `kind`) on both — matches the bands branches on lines 179 and 183.

## Verification

1. Build passes — no TS errors.
2. Open a workflow with an upstream node (e.g. Alpaca) connected to Visualize — node opens without crash.
3. Candle Data string input and Overlays repeater (Name / Data / Render / Color + Add) are visible.
4. Drag `bars` into Candle Data → candles render.
5. Add an overlay row, drag BB output into Data → lines render on the chart.
6. Remove a row → series disappears without remount.

## Out of scope

`Visualize.json`, `VisualizeNodePreview`, `chartTypes.ts`, and the normalizer's classification logic remain unchanged beyond the two type assertions.
