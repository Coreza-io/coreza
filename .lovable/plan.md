# Binance Stream Type: Auto-select Kline ↔ Continuous Kline by Market Type

## Goal

When the user changes **Market Type** on the Binance stream nodes:

- **Spot** → hide `Continuous Kline`, auto-select `Kline (Candlestick)` (and deselect `continuousKline` if it was on).
- **Futures (USDT-M)** → hide `Kline (Candlestick)`, auto-select `Continuous Kline` (and deselect `kline` if it was on).

Applies to both `BinanceStreamData` and `BinanceSubscribe` nodes.

## Changes

### 1. Node JSON — make `kline` spot-only (mirror existing `continuousKline` futures-only)

In `src/nodes/BinanceStreamData.json` and `src/nodes/BinanceSubscribe.json`, add `displayOptions.show.marketType: ["spot"]` to the `kline` stream-type option. `continuousKline` already has the futures-only rule.

This hides the wrong option per market type in the multiselect list.

### 2. Generic option-swap on parent change (NodeFieldRenderer)

In `src/components/nodes/layout/components/NodeFieldRenderer.tsx`, extend the `Select` `onValueChange` (the marketType field):

- After firing `onChange(field.key, val)`, scan sibling `multiselect` fields whose options carry `displayOptions.show[field.key]`.
- For each such multiselect, recompute selected values:
  - Drop any option ids whose `displayOptions.show[field.key]` no longer includes `val`.
  - If the dropped id has a configured replacement, push the replacement id.
  - If the resulting list is empty, fall back to the field's `default`.
- Emit a single `onChange(multiselectKey, newValues)`.

The replacement mapping is declared inline on the option:

```json
{
  "id": "kline",
  "name": "Kline (Candlestick)",
  "displayOptions": { "show": { "marketType": ["spot"] } },
  "swapTo": { "marketType": { "futures": "continuousKline" } }
},
{
  "id": "continuousKline",
  "name": "Continuous Kline",
  "displayOptions": { "show": { "marketType": ["futures"] } },
  "swapTo": { "marketType": { "spot": "kline" } }
}
```

Generic enough to reuse for any future parent→option swap (no Binance-specific code).

### 3. Apply the same swap metadata in `BinanceSubscribe.json`

Same two option entries as above (currently only `continuousKline` has `displayOptions`; `kline` has none and there is no swap mapping).

## Files

- `src/nodes/BinanceStreamData.json` — add `displayOptions` + `swapTo` on `kline`; add `swapTo` on `continuousKline`.
- `src/nodes/BinanceSubscribe.json` — same edits (note: this file currently uses `continuous_kline` id; I will keep its existing id and apply the same pattern).
- `src/components/nodes/layout/components/NodeFieldRenderer.tsx` — generic swap-on-parent-change logic in the Select `onValueChange`.

## Out of scope

- Backend stream-type handling (ids unchanged).
- Other node types.
- The `interval` (Kline Interval) field already shows correctly via existing `displayOptions`; no change needed.

## Verification

1. Open a Binance stream node, switch Market Type Spot ↔ Futures repeatedly.
2. Confirm the hidden option disappears from the Stream Type list.
3. Confirm the toggle for the visible counterpart auto-flips on (and the hidden one is removed from selection).
4. Confirm other selected stream types (e.g., `trade`, `bookTicker`) are preserved across the switch.
