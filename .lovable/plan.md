

# Plan: Align BinanceStreamData & BinanceSubscribe with Alpaca Pattern

## Files to Edit

### 1. `src/nodes/BinanceStreamData.json`

**Changes:**

- **`description`** (line 23): Update to: `"Receives real-time market data, news, or order fill events from Binance. Use BinanceSubscribe node to explicitly subscribe to market streams and/or Order Updates (Fills). Use an If node downstream to route market events vs order updates. Use Listen mode to receive pre-subscribed symbols, or Subscribe mode to subscribe and stream in one node."`

- **`height`** (line 27): Change from `280` to `320`

- **`stream_types`** (lines 152-192): Change `type` from `"select"` to `"multiselect"`, change `label` to `"Stream Types"`, set `default` to `["kline"]`, shorten option names (remove descriptions after dash), add `order_update` option `{"id": "order_update", "name": "Order Updates (Fills)"}`

- **`onlyClosedBars`** (lines 316-322): Convert from visible checkbox to hidden field: `{"key": "onlyClosedBars", "type": "hidden", "default": true}`

- **Add listen-mode filters** (matching Alpaca pattern): Add `filter_symbols` text field and `filter_types` multiselect field, both with `displayOptions.show.mode: ["listen"]`. `filter_types` includes all 7 Binance stream types plus `order_update`.

### 2. `src/nodes/BinanceSubscribe.json`

**Changes:**

- **`stream_types`** (lines 120-158): Change `type` from `"select"` to `"multiselect"`, change `label` to `"Stream Types"`, set `default` to `["kline"]`, shorten option names, add `order_update` option `{"id": "order_update", "name": "Order Updates (Fills)"}`

### No backend changes needed

The backend `stream.ts` already parses `stream_types` as an array and splits `order_update` to the trading source.

