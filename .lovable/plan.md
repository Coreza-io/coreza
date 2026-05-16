# Visualize node — fix: fields not visible after refactor

## Root cause (two bugs, same symptom)

The Visualize node opens with only the chart placeholder ("No candle data") and no input fields. Two layered issues:

1. **`src/components/nodes/NodeRouter.tsx` (line 107)** — forces Visualize to the `"basic"` layout, bypassing the repeater check. `BasicNodeLayout` does not know how to render `type: "repeater"` fields (only `RepeaterNodeLayout` does), so the `overlays` repeater would never render even if fields were shown.

2. **`src/components/nodes/layout/BasicNodeLayout.tsx` (lines 113–119)** — when `isVisualize`, renders the `<VisualizeNodePreview />` and then hides the entire fields `<form>` behind `{!isVisualize && ...}`. The `candles` string field is therefore never visible either.

Net effect: no Candle Data input, no Overlays repeater, only the empty chart.

## Fix

Use `RepeaterNodeLayout` for Visualize (it already handles both regular fields and repeater fields), and render the chart preview inside it.

### Changes

**`src/components/nodes/NodeRouter.tsx`**
- Remove the `if (definition?.name === "Visualize") return "basic";` short-circuit. Let the normal `hasRepeaterFields` detection route it to `"repeater"` (since `Visualize.json` has the `overlays` repeater).

**`src/components/nodes/layout/RepeaterNodeLayout.tsx`**
- Import `VisualizeNodePreview`.
- When `definition.name === "Visualize"`, render `<VisualizeNodePreview fieldState={fieldState} selectedInputData={selectedInputData} />` after the fields/repeater section (so users see fields on top, chart below). Pull `selectedInputData` the same way `BasicNodeLayout` does.

**`src/components/nodes/layout/BasicNodeLayout.tsx`**
- Revert the Visualize special-casing: remove the `isVisualize` branch, the `{!isVisualize && ...}` gate, and the `VisualizeNodePreview` import. `BasicNodeLayout` returns to being generic.

### Why this layout, not patching BasicNodeLayout

`BasicNodeLayout` has no repeater rendering. Duplicating the repeater UI there would fork two code paths. `RepeaterNodeLayout` already renders regular subfields plus repeater rows correctly, so attaching the chart preview there is the smallest, safest change.

## Verification

1. Open a workflow, drop a Visualize node — Candle Data string field and Overlays repeater (with Name/Data/Render/Color subfields and an Add button) are visible.
2. Connect Alpaca → Visualize. Drag `bars` from Input Panel into Candle Data → candles render below the fields.
3. Click "Add" in Overlays → a new row appears with empty Name/Data/Render/Color.
4. Drag BB output into the new row's Data → BB renders on the chart.
5. Removing a row or clearing Candle Data updates the chart immediately.

## Out of scope

No changes to `VisualizeNodePreview`, `LightweightVisualizeChart`, `visualizeNormalize`, or `Visualize.json`. The previously approved composite plan stands — this revision only restores field visibility.
