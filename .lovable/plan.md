# Visualize node — three concrete bugs to fix

The crash is gone, but the node still doesn't behave like a visualization node. Three independent issues, each with a small surgical fix.

## Bug 1 — Chart shows "No candle data" even though the template is filled

`VisualizeNodePreview` calls:

```ts
resolveReferences(String(fieldState.candles ?? ""), selectedInputData)
```

`resolveReferences` needs the full `{ allNodeData, getSourceData }` map to resolve cross-node templates like `{{ $('Alpaca').json.data.BarSeries[0].bars }}`. Passing only `selectedInputData` (which is a single node's data, not a map keyed by display name) returns the raw unresolved string, so `extractBars` returns `[]`.

**Fix**

- In `RepeaterNodeLayout`, build the preview context with the existing helper:
  ```ts
  const { allNodeData, getSourceData } = buildPreviewData(previousNodes, executionStore, getNodes);
  const sourceData = getSourceData(selectedPrevNodeId);
  ```
- Pass `sourceData` and `allNodeData` down to `VisualizeNodePreview` as new props.
- Inside `VisualizeNodePreview`, change every `resolveReferences(expr, selectedInputData)` call to `resolveReferences(expr, sourceData, allNodeData)`.

## Bug 2 — Overlays repeater never renders

`RepeaterNodeLayout` line 553 gates the repeater UI behind:
```ts
(isConditional || isFieldRepeater) && repeaterField
```
`overlays` is neither `conditions` nor `fields`, so the Add-row UI is never mounted. That is why the screenshot has no Overlays section between Candle Data and Execute.

**Fix**

- Add an `isOverlays = repeaterKey === "overlays"` flag near the existing `isConditional` / `isFieldRepeater` / `isSwitch` flags.
- Extend the gate on line 553 to include `isOverlays`, and inside that block render a generic rows + Add-row block driven by `repeaterField.subFields` (name / data / render / color) for the overlays case. Reuse `NodeFieldRenderer` per sub-field so drag-drop and preview behave like other string fields. Wire add/remove to `handleFieldStateBatch({ overlays: nextRows })`.
- Each row gets a stable `id` (uuid or counter) the first time it's created so the chart's overlay registry can diff cleanly.

## Bug 3 — Execute button + backend output for a UI-only node

Visualize is a pure visualization node, but the form still shows the standard Execute button, which runs the backend executor and fills the Output panel with `{ candles, overlays, support_nodes, edges }`. That's what the screenshot is showing in the right panel. The user expects no backend run — just a chart.

**Fix**

- In `RepeaterNodeLayout`, when `definition?.name === "Visualize"`, do not render the Execute button block. Keep error and auth modal rendering intact.
- Leave `useNodeExecution` wiring untouched (other code paths may reference it); just skip the button.

## Order of work

1. Bug 2 first — without the repeater UI, bugs 1 and 3 can't be observed end to end.
2. Bug 1 — pass real `sourceData` + `allNodeData` into `VisualizeNodePreview` and update its `resolveReferences` calls.
3. Bug 3 — hide Execute for Visualize.

## Verification

1. Open Visualize connected to Alpaca. Candle Data field is visible; below it an "Overlays" section with an "Add" button; no Execute button.
2. With the Alpaca template in Candle Data, candles render in the chart (no more "No candle data").
3. Click Add in Overlays, drop a BB template into Data, leave render = Auto. BB renders as 3 lines on the price pane.
4. Add a Volume Oscillator overlay. A second pane appears with synced time scale.
5. Remove an overlay row — its series disappears without remounting the chart.

## Out of scope

- No changes to `Visualize.json`, `chartTypes.ts`, `LightweightVisualizeChart.tsx`, or normalizer classification logic.
- No backend changes. The Visualize backend executor is untouched; the frontend simply doesn't invoke it.
