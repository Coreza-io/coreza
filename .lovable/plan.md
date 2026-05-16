# Fix drag-and-drop into Overlay subfields

## Symptom

- Dragging from Input Data into the top-level **Candle Data** field → works.
- Dragging from Input Data into an **Overlay** row's `data` (or `name`, `color`) input → field stays empty, no `{{ ... }}` text appears.

So the bug is specific to the repeater subfield path, not the generic drop pipeline.

## Root cause

`src/hooks/useNodeReferences.ts` `handleDrop` performs two writes on every drop:

```ts
setter(newValue);                    // routed by the caller
handleChange(fieldKey, newValue);    // ALWAYS writes top-level fieldState[fieldKey]
```

`RepeaterNodeLayout` wires the two paths differently:

| Target              | `setter` does                                       |
|---------------------|-----------------------------------------------------|
| Top-level field     | `(val) => handleChange(fieldDef.key, val)`          |
| Overlay subfield    | `(val) => updateOverlay(rowIndex, fieldDef.key, val)` → `handleFieldStateBatch({ overlays: [...] })` |

For the **top-level** case both writes target `fieldState[fieldDef.key]`, so the duplicate call is harmless — that's why Candle Data works.

For the **overlay** case the two writes hit different slices of state, and `useNodeFieldState` builds each next state from the **closure copy** of `fieldState` rather than a functional updater:

```ts
const newFieldState = { ...fieldState, [key]: normalizedValue };
setFieldState(newFieldState);
setNodes(... values: newFieldState ...);
```

Sequence on an overlay drop:

1. `setter(newValue)` → `updateOverlay` → `handleFieldStateBatch({ overlays: rowsWithData })` writes `{ ...stale, overlays: rowsWithData }`.
2. `handleChange("data", newValue)` runs in the same tick, still holding the **stale** `fieldState` (without the overlay update), and writes `{ ...stale, data: newValue }` — clobbering the overlays change from step 1.

The overlay row reverts to empty; a stray top-level `data` key is set but never rendered.

## Fix

Two small, isolated edits:

1. **`src/hooks/useNodeReferences.ts`** — remove the redundant `handleChange(fieldKey, newValue)` inside `handleDrop`. The `setter(newValue)` argument is already wired to the correct destination by each caller (`handleChange` for basic, `updateOverlay` for overlays, `updateCondition`/`updateCase` for repeaters). Keep the `setSourceMap` update.

2. **`src/hooks/useNodeFieldState.ts`** — convert `handleChange` and `handleFieldStateBatch` to functional `setFieldState((prev) => …)` updates and mirror the same `prev`-based object into `setNodes`. This makes back-to-back state writes in one tick safe and stable even outside this bug. Drop `fieldState` from the `useCallback` dep arrays so the callbacks are referentially stable.

No changes to `RepeaterNodeLayout`, `NodeFieldRenderer`, `LightweightVisualizeChart`, `Visualize.json`, or backend.

## Verification

- Drag `BB.data` from Input Data onto overlay row's data field → input fills with `{{ $('Bollinger Bands').json.data }}` and the chart re-renders with the overlay.
- Drag onto Candle Data (top-level) — still works exactly as today.
- Add two overlay rows, drop into each — both retain their values.
- Drop into a Conditional / Switch repeater cell — unchanged behavior.
