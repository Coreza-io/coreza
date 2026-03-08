

# Change Stream Types from Multiselect to Select + Order Update Checkbox

## Current State
Both `AlpacaSubscribe.json` and `AlpacaStreamData.json` have `stream_types` as a `multiselect` with options: Trades, Quotes, Bars, Daily Bars, Order Updates.

## Proposed Change
Split `stream_types` into two fields:

### 1. `stream_type` (singular) — `type: "select"` (single choice)
Options: Trades, Quotes, Bars (1-min), Daily Bars

### 2. `include_order_updates` — `type: "checkbox"` / `type: "toggle"`
Label: "Include Order Updates (Fills)"
Default: `false`
When checked, the backend receives `order_update` appended to the stream types array.

## Files to Change

### `src/nodes/AlpacaSubscribe.json`
- Replace `stream_types` multiselect (lines 102-136) with:
  - `stream_type` select field with options: trade, quote, bar, daily_bar
  - `include_order_updates` checkbox field, default false
- Both fields keep `displayOptions: { show: { data_type: ["market", "crypto"] } }`

### `src/nodes/AlpacaStreamData.json`
- Same replacement for `stream_types` multiselect (lines 154-189)
- Keep existing `displayOptions`

### Backend: payload assembly
- Wherever `stream_types` array is read from the node payload, we need to construct it from `stream_type` (single value → array) + conditionally append `"order_update"` if `include_order_updates` is true.
- Check `MarketControlHandler.ts` and stream route handler to see if they read `stream_types` directly or if the frontend assembles it.

Since the backend expects `stream_types` as an array, the simplest approach is to keep sending `stream_types` as the key but assemble it in the execution logic. However, looking at how node fields work — the backend receives whatever field keys are in the JSON. So we'd need the backend to handle `stream_type` (string) + `include_order_updates` (boolean) and build the array.

**Alternative (simpler)**: Keep the field key as `stream_types` but change to select. Then add `include_order_updates` checkbox. In the backend stream route / `MarketControlHandler`, convert: `stream_types = [body.stream_types]` if string, then `if (body.include_order_updates) stream_types.push('order_update')`.

### Backend files to update
- `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts` — where `streamTypes` is read from request
- `coreza-backend/src/routes/streamRoutes.ts` or equivalent — where subscribe payload is processed

## Summary

| File | Change |
|---|---|
| `src/nodes/AlpacaSubscribe.json` | Replace `stream_types` multiselect → `stream_types` select (single) + `include_order_updates` checkbox |
| `src/nodes/AlpacaStreamData.json` | Same replacement |
| Backend handler(s) | Normalize `stream_types` from string to array, append `order_update` if checkbox true |

