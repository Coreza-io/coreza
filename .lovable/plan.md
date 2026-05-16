# Visualize node — chart data exists but chart area is still blank

## Updated diagnosis

The latest screenshot proves the Candle Data field resolves correctly:

- The field preview shows an array with 594 bar items.
- `viewModel.candles` is therefore not the remaining blocker.
- The visible Visualize node still shows only the fields and overlays section; there is no chart, no empty-state overlay, and no reserved 320px chart area.

That changes the root-cause priority. The issue is now more likely that the chart preview is mounted outside the visible/scrollable node content, not that the data model is empty.

## Primary root cause

In `RepeaterNodeLayout.tsx`, the chart preview is rendered after the closing `</form>`:

```tsx
</form>

{definition?.name === "Visualize" && (
  <div className="pt-2">
    <VisualizeNodePreview ... />
  </div>
)}
```

The expanded node card is constrained by React Flow / `NodeWrapper` sizing and panel layout. Rendering the chart outside the form means it is not part of the same visible field stack where the Candle Data and Overlays controls live. In the current UI, that makes the preview effectively invisible even though `VisualizeNodePreview` can build a valid view model.

## Primary fix

Move the Visualize chart preview inside the form, directly after the Overlays repeater and before the dependency/submit/error blocks.

Target structure:

```tsx
<form className="space-y-3" onSubmit={handleSubmit}>
  ...Candle Data field...
  ...Overlays repeater...

  {definition?.name === "Visualize" && (
    <div className="pt-2">
      <VisualizeNodePreview
        fieldState={fieldState}
        sourceData={visualizePreviewContext.sourceData}
        allNodeData={visualizePreviewContext.allNodeData}
      />
    </div>
  )}

  ...skip dependency...
  ...non-Visualize Execute button...
  ...error...
</form>
```

Then remove the duplicate preview block currently rendered after `</form>`.

## Chart container guard

Keep the current `LightweightVisualizeChart.tsx` approach:

- Always render `<div ref={priceRef} />`.
- Give it explicit `height: PRICE_HEIGHT`.
- Show `No candle data` as an overlay only when candles are empty.

This is still correct because it prevents the old `priceRef.current === null` first-render deadlock.

## Lightweight Charts v5 TypeScript fix

The current source already migrated overlays from `addLineSeries(...)` to `addSeries(LineSeries, ...)`, but TypeScript still fails because `toLineData()` returns `time: number`, while v5 expects `time: Time`.

Update `lightweightSeriesBuilder.ts`:

```tsx
const toLineData = (points: SeriesPoint[]): Array<{ time: Time; value: number }> =>
  points
    .filter((point) => point.value !== null)
    .map((point) => ({ time: point.time as Time, value: point.value as number }));
```

No other chart logic needs to change for this build error.

## Optional layout improvement if chart is still cramped

If moving the preview inside the form shows the chart but it is clipped by the node height, update Visualize sizing only:

- `src/nodes/Visualize.json`: increase `size.height` from `540` to around `820`.
- Keep width unchanged unless the chart feels too narrow.

This is a layout-only adjustment and should be done only if clipping remains visible.

## Out of scope

- No backend changes.
- No changes to Candle Data resolution.
- No changes to `Visualize.json` unless clipping remains after the preview is moved.
- No changes to normalizer classification logic.

## Verification

1. Open Visualize with Alpaca connected.
2. Confirm Candle Data preview still shows 594 bars.
3. Confirm a 320px chart area appears directly below Overlays.
4. Confirm candlestick + volume chart renders without pressing Execute.
5. Add an overlay and confirm no v5 `addLineSeries` or TypeScript time errors occur.