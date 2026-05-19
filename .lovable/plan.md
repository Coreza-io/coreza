# Fix: Visualize chart stays blank until re-expand

## Root cause

The previous chart-ready fix handles the chart initialization timing, but the screenshot shows a second stale-data path:

1. `BaseNode` subscribes to `useExecutionStoreVersion()`, so the outer node re-renders when upstream execution output changes.
2. `RepeaterNodeLayout` reads the execution store via `useExecutionStore()`, but it does **not** subscribe to the store version directly.
3. `visualizePreviewContext` is memoized from `getPreviewData()`. Since the `ExecutionContext` object identity does not change when node output changes, the memo can keep the old empty `allNodeData/sourceData` while the Visualize preview remains mounted.
4. Collapsing/re-expanding remounts/recomputes the preview context, so the same data suddenly renders.

So the chart component can be ready, but it is still receiving stale empty preview data until the node panel remounts.

## Fix

Make the Visualize preview context react to execution-store updates.

### `src/components/nodes/layout/RepeaterNodeLayout.tsx`

1. Import `useExecutionStoreVersion` from `ExecutionStoreContext`.
2. Call `const executionStoreVersion = useExecutionStoreVersion();` next to `useExecutionStore()`.
3. Add `executionStoreVersion` to the dependency list of:
   - `getPreviewData`
   - `getOverlayPreviewFor`
   - `visualizePreviewContext`
   - any preview resolver callbacks that use `getPreviewData` and depend on runtime output.

This forces the Visualize preview to rebuild `sourceData` and `allNodeData` whenever upstream bars/indicator output is populated, without needing to collapse and expand the node.

### `src/components/charts/LightweightVisualizeChart.tsx`

Keep the current `chartReady` implementation, with one small cleanup:

- In the init effect cleanup, set `chartReady` back to `false` after clearing chart refs.

No chart rendering behavior should otherwise change.

## Verification

- Expand Visualize first while there is no bar data: chart shows empty state.
- Run/connect upstream bars and ADX while Visualize stays expanded: candles and ADX panel render immediately.
- Collapse/re-expand is no longer required.
- Existing flow still works when data is already available before Visualize expands.
- Crosshair legends, OHLC values, and chart wheel/pinch behavior remain unchanged.
