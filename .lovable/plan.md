# Visualize node — fix: fields not visible + TypeScript build errors

## Problem 1: No input fields visible in the Visualize node

### Root cause (two layered bugs)

1. **`src/components/nodes/NodeRouter.tsx` (line 107)** — short-circuits Visualize to the `"basic"` layout, bypassing the repeater detection. `BasicNodeLayout` doesn't render `type: "repeater"` fields, so the `overlays` repeater would never appear even if fields were shown.

2. **`src/components/nodes/layout/BasicNodeLayout.tsx` (lines 113–119)** — when `isVisualize`, renders only the chart preview and gates the whole fields `<form>` behind `{!isVisualize && ...}`. The `candles` string input is therefore also hidden.

Net effect: empty chart with "No candle data" and no way to provide any.

### Fix

Route Visualize through `RepeaterNodeLayout` (it already handles both regular subfields and repeater fields) and host the chart preview inside it.

- **`NodeRouter.tsx`** — delete the `if (definition?.name === "Visualize") return "basic";` line so the existing `hasRepeaterFields` check routes Visualize to `"repeater"`.
- **`RepeaterNodeLayout.tsx`** — import `VisualizeNodePreview` and, when `definition.name === "Visualize"`, render it after the fields/repeater section, passing `fieldState` and `selectedInputData` (resolved the same way as `BasicNodeLayout`).
- **`BasicNodeLayout.tsx`** — revert the Visualize special-casing: remove the `isVisualize` constant, the preview branch, the `{!isVisualize && ...}` gate, and the `VisualizeNodePreview` import. Restores `BasicNodeLayout` to generic.

## Problem 2: TypeScript build errors

The codebase installed `lightweight-charts@^5.2.0`, but `LightweightVisualizeChart.tsx` was written against the v4 API.

### Errors and fixes

**`src/components/charts/LightweightVisualizeChart.tsx`**

- `addCandlestickSeries()` / `addHistogramSeries()` no longer exist in v5. Use `chart.addSeries(CandlestickSeries, options)` and `chart.addSeries(HistogramSeries, options)` (imported from `lightweight-charts`).
- Histogram `time` typing: cast each datum's `time` to `Time` (same as the candle mapping already does) — `toVolumeData` returns plain numbers; either change its return type to `{ time: Time; value: number; color: string }[]` or cast at the call site.
- `subscribeVisibleLogicalRangeChange` handler signature is `(range: LogicalRange | null) => void`. The current `fromFirst`/`fromSecond` helpers are typed via the return type of `getVisibleLogicalRange` (a function-returning-LogicalRange), which is wrong. Type the parameter as `LogicalRange | null` directly (import `LogicalRange` from `lightweight-charts`).

**`src/utils/visualizeNormalize.ts` (lines 193, 198)**

- Two `{ kind: "levels", ... }` literals are typed as plain `string` for `kind` because they aren't asserted. Add `as OverlayClassification` (or `as const` on `kind`) on both branches, matching the pattern already used for the bands literals on lines 179, 183.

## Verification

1. Build passes with no TS errors.
2. Open a workflow, drop a Visualize node — Candle Data string input and Overlays repeater (with Name / Data / Render / Color subfields and an Add button) are visible.
3. Connect Alpaca → Visualize. Drag `bars` from Input Panel into Candle Data → candles render below the fields.
4. Click "Add" in Overlays → row appears. Drag BB output into its Data → BB renders as lines on the chart.
5. Add an oscillator overlay (Volume Oscillator) → second pane appears below, time scale synced with the price pane on zoom/scroll.
6. Remove an overlay row → corresponding series disappears without remount.

## Out of scope

No changes to `Visualize.json`, `VisualizeNodePreview`, `chartTypes.ts`, or the normalizer's logic beyond the two type assertions.
