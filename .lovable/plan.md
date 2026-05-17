# Fix overlay drag-and-drop specifically

## Actual issue

- Candle Data drag/drop works.
- Overlay row fields are the only failing target.
- The overlay input can contain manually typed `{{ $('BB').json.data }}`, but the drag/drop path still does not reliably populate it.

This means the remaining problem is not chart rendering, candle parsing, or the top-level reference insertion flow. It is specific to how overlay repeater subfields are wired.

## Step-by-step analysis

1. **Top-level Candle Data path is simple and works**

   ```text
   NodeFieldRenderer drop
     -> useNodeReferences.handleDrop("candles", setter)
     -> setter(newValue)
     -> handleChange("candles", newValue)
     -> fieldState.candles updates
   ```

2. **Overlay fields currently reuse the top-level helper even though they are nested**

   ```text
   NodeFieldRenderer drop
     -> useNodeReferences.handleDrop("data", setter)
     -> setter(newValue)
     -> updateOverlay(rowIndex, "data", newValue)
     -> fieldState.overlays[rowIndex].data should update
   ```

3. **The overlay field key is not globally unique**

   Every overlay row has subfields named `name`, `data`, `render`, and `color`. Passing only `fieldDef.key` (`"data"`) into the generic drop helper loses the nested identity:

   ```text
   overlay[0].data  -> fieldKey "data"
   overlay[1].data  -> fieldKey "data"
   top-level data   -> fieldKey "data" if any node has one
   ```

   This is harmless for Candle Data because `candles` is top-level and unique. It is fragile for overlay rows.

4. **`useNodeReferences.getFieldPreview` cannot resolve nested overlay paths**

   `RepeaterNodeLayout` calls:

   ```ts
   getFieldPreview(`overlays.${rowIndex}.${fieldKey}`)
   ```

   But `useNodeReferences.getFieldPreview` does:

   ```ts
   const expr = fieldState[fieldKey] || "";
   ```

   For `fieldKey = "overlays.0.data"`, that always reads `fieldState["overlays.0.data"]`, not `fieldState.overlays[0].data`. So preview/source tracking is broken for overlay subfields even if the input text is present.

5. **The shared top-level drop helper is the wrong abstraction for overlay subfields**

   `RepeaterNodeLayout` already has a local nested drop helper for conditional/switch repeaters: `computeDropInsert` + `handleDropWithInsert`. Overlay fields should use that local nested path too, because it updates the exact row and exact subfield without pretending the nested subfield is a top-level field.

## Why IF/Switch repeaters work but Overlay does not

The important difference is the handler path, not the rendered input component.

### IF condition rows

IF row fields use `handleRepeaterDrop`:

```text
NodeFieldRenderer drop
  -> handleRepeaterDrop(rowIndex, fieldKey, event, currentValue)
  -> handleDropWithInsert(...)
  -> updateCondition(rowIndex, fieldKey, currentValue + insert)
  -> handleChange("conditions", updatedConditions)
```

That means IF only writes to the nested repeater array: `fieldState.conditions`.

It does **not** call `useNodeReferences.handleDrop("left" | "right", ...)`, so it does not create stray top-level `left` / `right` fields and it does not run the duplicate top-level `handleChange` path.

### Switch case rows

Switch row fields use `handleSwitchConditionDrop`:

```text
NodeFieldRenderer drop
  -> handleSwitchConditionDrop(rowIndex, fieldKey, event, currentValue)
  -> handleDropWithInsert(...)
  -> updateCase(rowIndex, fieldKey, currentValue + insert)
  -> handleChange("cases", updatedCases)
```

That means Switch only writes to the nested repeater array: `fieldState.cases`.

It does **not** call `useNodeReferences.handleDrop("left" | "right", ...)` for nested case cells.

### Overlay rows

Overlay row fields currently use the generic top-level helper:

```text
NodeFieldRenderer drop
  -> useNodeReferences.handleDrop("data", setter, event, currentValue)
  -> setter(newValue)
  -> updateOverlay(rowIndex, "data", newValue)
  -> handleFieldStateBatch({ overlays: updatedOverlays })
  -> handleChange("data", newValue)
```

That final `handleChange("data", newValue)` is the key difference. It treats overlay `data` as if it were a top-level field. IF/Switch avoid this entirely.

So Overlay has two problems IF/Switch do not have:

1. It writes both `fieldState.overlays[rowIndex].data` and stray top-level `fieldState.data`.
2. Because `handleChange` / `handleFieldStateBatch` still use closure-based `fieldState`, those back-to-back writes can overwrite each other.

The same issue also applies to overlay preview: IF/Switch preview receives the actual nested value (`cond.left`, `caseItem.right`), while Overlay calls `getFieldPreview("overlays.0.data")`, which the generic preview hook reads as `fieldState["overlays.0.data"]` instead of `fieldState.overlays[0].data`.

## Fix

Make overlay drag/drop use an overlay-specific nested handler instead of the generic top-level `handleDrop`.

### 1. `src/components/nodes/layout/RepeaterNodeLayout.tsx`

Add a dedicated overlay drop handler:

```ts
const handleOverlayDrop = useCallback(
  (rowIndex: number, field: string, e: React.DragEvent, currentValue: string) => {
    handleDropWithInsert(e, currentValue, (insert) => {
      updateOverlay(rowIndex, field, currentValue + insert);
    });
  },
  [handleDropWithInsert, updateOverlay]
);
```

Then replace the overlay subfield `onDrop` block with:

```ts
onDrop={(fieldDef, e, currentValue) =>
  handleOverlayDrop(rowIndex, fieldDef.key, e, currentValue)
}
```

This bypasses the top-level `fieldKey = "data"` ambiguity and writes directly to `fieldState.overlays[rowIndex].data`.

### 2. `src/components/nodes/layout/RepeaterNodeLayout.tsx`

For overlay rows, stop using the generic `getFieldPreview("overlays.0.data")` because it cannot read nested paths from `fieldState`.

Add a local overlay preview resolver that receives the actual overlay cell value:

```ts
const getOverlayPreviewFor = useCallback((expr: unknown) => {
  if (typeof expr !== "string" || !expr.includes("{{")) return null;
  const { allNodeData, getSourceData } = getPreviewData();
  const srcData = getSourceData(selectedPrevNodeId);
  try {
    return fullePreview(resolveReferences(expr, srcData, allNodeData, getNodes()));
  } catch {
    return "";
  }
}, [getPreviewData, selectedPrevNodeId, getNodes]);
```

Then wire overlay fields as:

```ts
getPreview={() => getOverlayPreviewFor(overlayRow?.[subField.key])}
```

This fixes overlay preview separately from top-level fields.

### 3. `src/hooks/useNodeReferences.ts`

Keep the previous cleanup: `handleDrop` should not force an extra top-level `handleChange(fieldKey, newValue)` after calling `setter(newValue)`. The setter already points to the right destination for top-level fields.

### 4. `src/hooks/useNodeFieldState.ts`

Keep the previous functional state update fix for `handleChange` and `handleFieldStateBatch`, so nested repeater updates cannot be clobbered by stale closure state.

## Verification

- Drag `BB.data` onto overlay row 1 `data` field -> the overlay input fills with `{{ $('Bollinger Bands').json.data }}`.
- Drag onto overlay row 2 `data` field -> row 1 remains unchanged, row 2 updates independently.
- Drag onto overlay `name` or `color` -> the correct row/subfield updates.
- Drag onto Candle Data -> still works.
- Overlay preview/chart update uses `fieldState.overlays[rowIndex].data`, not a fake top-level `fieldState["overlays.0.data"]` key.

## Out of scope

- No chart lifecycle changes.
- No candle-data changes.
- No backend changes.
- No Visualize node schema changes.
