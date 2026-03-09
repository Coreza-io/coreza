

# Plan: Align BinanceStreamData & BinanceSubscribe Nodes with Alpaca Pattern

## What Changed in Alpaca (the reference)

1. **`stream_types`**: Changed from single-select to **multiselect** with simplified options (Trades, Quotes, Bars, Daily Bars) + **Order Updates (Fills)** as an option
2. **Interval**: Hidden with default `1m` — not user-selectable (Alpaca only supports minute and daily bars)
3. **`onlyClosedBars`**: Removed as a visible checkbox — always emit closed bars
4. **Description**: Updated to mention order fills and If node routing

## What Needs to Change in Binance

### 1. `BinanceStreamData.json` — Stream trigger node

| Field | Current | Target |
|---|---|---|
| `stream_types` | `type: "select"` (single) | `type: "multiselect"` with `order_update` added |
| `stream_types` options | 7 options (trade, aggTrade, kline, miniTicker, ticker, bookTicker, depth) | Keep all 7 + add `order_update` "Order Updates (Fills)" |
| `interval` | Full select with 15 options, shown when `stream_types: ["kline"]` | Keep as-is — Binance genuinely supports multiple kline intervals (unlike Alpaca). Show only when kline is selected |
| `depth_levels` | Shown when `stream_types: ["depth"]` | Keep as-is, but update displayOptions for multiselect compatibility |
| `onlyClosedBars` | Visible checkbox, default true | Remove — make it a hidden field with default `true` (always emit closed bars) |
| `description` | "Also automatically streams order fill events" | Update to match Alpaca pattern: mention If node routing for order updates |
| `height` | 280 | 320 (slightly taller for multiselect) |

### 2. `BinanceSubscribe.json` — Subscription node

| Field | Current | Target |
|---|---|---|
| `stream_types` | `type: "select"` (single) | `type: "multiselect"` with `order_update` added |
| `stream_types` options | 7 options | Keep all 7 + add `order_update` "Order Updates (Fills)" |
| `depth_levels` displayOptions | `stream_types: ["depth"]` | Same — works with multiselect since backend parses array |
| `interval` displayOptions | `stream_types: ["kline"]` | Same — show when kline is in the multiselect |

### 3. No Backend Changes Needed

The backend `stream.ts` route already:
- Parses `stream_types` as array (lines 108-112)
- Splits out `order_update` to `binance_trading` source (lines 114-131)
- Passes remaining types to market subscription
- Handles both Alpaca and Binance identically

## Key Difference from Alpaca

Binance supports multiple kline intervals (1m, 5m, 1h, 1d, etc.), so the `interval` selector must **remain visible** when `kline` is selected — unlike Alpaca where it was hidden and defaulted to `1m`. This is a legitimate broker capability difference.

## Files to Edit

| File | Changes |
|---|---|
| `src/nodes/BinanceStreamData.json` | Change `stream_types` to multiselect, add `order_update` option, convert `onlyClosedBars` to hidden with default true, update description, adjust height |
| `src/nodes/BinanceSubscribe.json` | Change `stream_types` to multiselect, add `order_update` option, add default `["kline"]` |

