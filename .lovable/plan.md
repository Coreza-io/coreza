
# Dynamic Binance Trade Update Stream Type Based on Market Type

## Problem
The "Trade Updates (Fills)" toggle in BinanceStreamData always sends `ORDER_TRADE_UPDATE` as the stream type, regardless of whether Spot or Futures is selected. Binance Spot uses `executionReport` while Futures uses `ORDER_TRADE_UPDATE`. The backend already handles both correctly, but the frontend needs to send the right value.

## Approach
Add a new `valueMap` property to multiselect options in the node JSON schema. This allows a single toggle to resolve to different values based on another field's value. The `NodeFieldRenderer` multiselect handler will check for `valueMap` and swap the option id dynamically.

## Changes

### 1. `src/nodes/BinanceStreamData.json`
Replace the hardcoded `ORDER_TRADE_UPDATE` option with a `valueMap`-enabled option:

```json
{
  "id": "ORDER_TRADE_UPDATE",
  "name": "Trade Updates (Fills)",
  "valueMap": {
    "field": "marketType",
    "values": {
      "spot": "executionReport",
      "futures": "ORDER_TRADE_UPDATE"
    }
  }
}
```

Also fix the typo: "Tarde Updates" -> "Trade Updates" (line 188).

Do the same for the `filter_types` section (line 438).

### 2. `src/components/nodes/layout/components/NodeFieldRenderer.tsx`
In the multiselect renderer (line ~562-592):

- Filter out options that have per-option `displayOptions` that don't match current field state (this already exists for some options like markPrice/liquidation but the renderer doesn't filter them).
- When toggling an option that has a `valueMap`, resolve the actual id based on the referenced field's current value. When toggling ON, insert the resolved id. When toggling OFF, remove both possible mapped values to avoid stale entries.
- When checking `isSelected`, check against all possible mapped values from `valueMap`.

### 3. `src/nodes/schemas/nodeSchema.ts`
Add `valueMap` to the option type definition so TypeScript is aware of the property (if the schema defines option types).

## How It Works (User Experience)
- User selects Market Type = Spot
- User toggles "Trade Updates (Fills)" ON
- Frontend stores `["executionReport"]` in the `stream_type` array
- User switches Market Type to Futures
- Frontend automatically resolves to `["ORDER_TRADE_UPDATE"]`
- Backend receives the correct native event type

## Backend Impact
None. The backend's `ORDER_UPDATE_MARKERS` set and `computeTradingNativeStreams` already handle both `executionReport` and `ORDER_TRADE_UPDATE`. This change ensures the frontend sends the correct value upfront.

## Also Fix
- Per-option `displayOptions` filtering: the multiselect renderer currently shows all options regardless of per-option displayOptions. Add filtering using the existing `isFieldVisible` helper so futures-only options (markPrice, liquidation, etc.) are hidden when spot is selected.
