# Visualize node — corrected surgical fix

## What went wrong with the last patch

The last patch removed `useExecutionStore()` and `useReactFlow()` declarations from `RepeaterNodeLayout.tsx`, then deleted the buggy `selectedInputData` `useMemo`. But `executionStore` and `getNodes` are still consumed later in the file — by `buildPreviewData(previousNodes, executionStore, getNodes)` inside `getPreviewFor` (line ~449) and `getSwitchPreviewFor` (line ~479). Removing the hooks broke those, producing:

```
ReferenceError: executionStore is not defined
  at RepeaterNodeLayout (RepeaterNodeLayout.tsx:467)
```

## Correct fix

Keep the hook calls. Only fix the broken `selectedInputData` derivation.

### `src/components/nodes/layout/RepeaterNodeLayout.tsx`

1. Restore (or keep) at the top of the component:
   ```ts
   const { getNodes } = useReactFlow();
   const executionStore = useExecutionStore();
   const { user } = useAuth();
   ```
   Keep the corresponding imports (`useExecutionStore`, `useReactFlow`, `useAuth`).

2. Add `selectedInputData` to the destructured props (it already flows in from `BaseNode` via `BaseNodeRenderProps`).

3. Replace the buggy local `selectedInputData` `useMemo` (the block that referenced `executionStore.executionOutput[nodeId]`, which does not exist on `ExecutionContext`) — simply delete that `useMemo` and rely on the `selectedInputData` prop. If `getDisplayName` is no longer referenced anywhere else, drop that import too; otherwise leave it.

That's it for the crash. All other references to `executionStore` / `getNodes` in this file stay untouched.

## Still-pending items from the prior plan (unchanged)

- `NodeRouter.tsx` — Visualize routes through `RepeaterNodeLayout` (no short-circuit to `"basic"`).
- `RepeaterNodeLayout.tsx` — render `<VisualizeNodePreview fieldState={fieldState} selectedInputData={selectedInputData} />` after the fields section when `definition.name === "Visualize"`.
- `BasicNodeLayout.tsx` — no Visualize-specific branch.
- `LightweightVisualizeChart.tsx` — v5 API: `chart.addSeries(CandlestickSeries, options)` / `addSeries(HistogramSeries, options)`, type the `LogicalRange | null` handler param, cast histogram `time` to `Time`.
- `visualizeNormalize.ts` — `as OverlayClassification` on the two `kind: "levels"` literals.

## Verification

1. App loads without `ReferenceError`.
2. Open Visualize node with an upstream node connected — no crash.
3. Candle Data input + Overlays repeater visible.
4. Drag bars → candles render. Add overlay row → series renders.

## Out of scope

No changes to `Visualize.json`, `VisualizeNodePreview`, `chartTypes.ts`, or normalizer classification logic beyond the two type assertions.
