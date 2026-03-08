

# Plan: Move Trading Subscriptions to AlpacaSubscribe Node

## Problem
Currently, `alpaca_trading` (order fill events) is automatically spawned as a companion whenever `AlpacaStreamData` activates a market/crypto stream. The user wants explicit control: subscribe to `alpaca_trading` via the **AlpacaSubscribe** node, and have **AlpacaStreamData** simply emit whatever has been subscribed (including trading events).

## Architecture Change

```text
BEFORE:
  AlpacaStreamData (trigger) → auto-spawns alpaca_trading companion

AFTER:
  AlpacaSubscribe (action) → user explicitly subscribes to "trading" stream type
  AlpacaStreamData (trigger) → just listens/emits, no auto-companion
```

## Changes Required

### 1. Frontend — AlpacaSubscribe.json
- Change `stream_types` field from `type: "select"` to `type: "multiselect"` (checkboxes, like the screenshot shows)
- Add a new option: `{ id: "order_update", name: "Order Updates (Fills)" }`
- This option should be visible for all data_types (market, crypto) — trading updates are account-wide
- Default stays `["trade"]`

### 2. Frontend — AlpacaStreamData.json
- Add `order_update` to the `filter_types` multiselect options (listen mode) so users can filter for it
- Add `order_update` to the `stream_types` multiselect options (subscribe mode) so self-contained mode also works
- Update description to reflect that trading updates come via subscription, not automatically

### 3. Backend — Subscribe endpoint (`stream.ts` line 72-148)
When `stream_types` includes `"order_update"`, the backend needs to:
- Detect that `order_update` is in the stream_types array
- Separate it out: subscribe to `alpaca_trading` source with `symbols: ["*"]` using the same credential
- Subscribe the remaining market stream_types (trade, quote, bar) to the normal `alpaca_market`/`alpaca_crypto` source
- This happens in the existing `/:source/subscribe` handler — add logic after line 107 to check for `order_update` in streamTypes

### 4. Backend — Remove auto-companion from execute-stream-node (`stream.ts` lines 453-477)
Remove the automatic companion gateway spawning block. Trading subscriptions will now come explicitly from the AlpacaSubscribe node. Same for `workflow.ts` lines 561-577 and 759-773.

### 5. Backend — Unsubscribe endpoint (`stream.ts` line 154)
Mirror the subscribe logic: when `stream_types` includes `"order_update"`, also unsubscribe from `alpaca_trading`.

## Files to Change

| File | Change |
|---|---|
| `src/nodes/AlpacaSubscribe.json` | Change stream_types to multiselect, add `order_update` option |
| `src/nodes/AlpacaStreamData.json` | Add `order_update` to filter_types and stream_types options |
| `coreza-backend/src/routes/stream.ts` | Handle `order_update` in subscribe/unsubscribe; remove auto-companion from execute-stream-node |
| `coreza-backend/src/routes/workflow.ts` | Remove auto-companion from activate/deactivate |

