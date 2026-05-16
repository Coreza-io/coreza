# Fix drag-and-drop into Overlays subfields

## Problem

Dragging a value from the Input Data panel (e.g. `BB.data`) onto an overlay row's `data` input does nothing — the field stays empty after drop.

## Root cause

In `src/hooks/useNodeReferences.ts`, `handleDrop` does two writes back to state:

```ts
setter(newValue);                       // for overlays: updateOverlay(row, "data", newValue)
handleChange(fieldKey, newValue);       // also writes top-level fieldState["data"]
```

Both `useNodeFieldState.handleChange` and `handleFieldStateBatch` build their next state from the **closure copy of `fieldState`** rather than from the latest state:

```ts
const newFieldState = { ...fieldState, [key]: normalizedValue };
setFieldState(newFieldState);
setNodes(... values: newFieldState ...);
```

Sequence during an overlay drop:

1. `setter(newValue)` → `updateOverlay` → `handleFieldStateBatch({ overlays: [...with data set] })` updates `fieldState.overlays`.
2. `handleChange("data", newValue)` runs immediately after, still seeing the **stale** `fieldState` (without the overlays update), and writes `{ ...stale, data: newValue }`. This silently overwrites the overlay row update from step 1.

Net effect: the overlay row's `data` cell reverts to empty; a stray top-level `data` key gets set but is never rendered. The user sees an empty input after dropping.

## Fix

Two small, isolated changes:

1. `src/hooks/useNodeReferences.ts` — remove the redundant `handleChange(fieldKey, newValue)` call inside `handleDrop`. The `setter(newValue)` argument already routes the write to the correct destination (top-level field for basic nodes via `(val) => handleChange(key, val)`; overlay row via `updateOverlay`; condition cell via `updateCondition`, etc.). Keep the `sourceMap` update.

2. `src/hooks/useNodeFieldState.ts` — convert `handleChange` and `handleFieldStateBatch` to functional updates so back-to-back writes in the same tick can't clobber each other:
   ```ts
   setFieldState((prev) => {
     const next = { ...prev, [key]: normalizedValue };
     // dynamicOptions handling stays the same, against `next`
     setNodes((nds) => nds.map((n) =>
       n.id === nodeId
         ? { ...n, data: { ...n.data, values: next, fieldState: next } }
         : n));
     return next;
   });
   ```
   Same pattern for `handleFieldStateBatch`. Drop `fieldState` from the `useCallback` deps so the callbacks are stable.

## Verification

- Drag `BB.data` from Input Data onto overlay row 1's data field → field shows `{{ $('Bollinger Bands').json.data }}` and chart re-renders with the overlay.
- Drag onto a basic node field (e.g. condition `left`) — still works as before.
- Adding multiple overlays and dropping into each one preserves the values.

## Out of scope

No changes to chart rendering, `RepeaterNodeLayout`, `NodeFieldRenderer`, Visualize.json, or backend.
