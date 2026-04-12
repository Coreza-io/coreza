

# Fix Stream Badge: Environment, Symbol, and Event Type for Trading Streams

## Issues

1. **Environment always shows "Live"**: `getEnvironment()` checks for `"testnet"` or `"paper"` in the source string, but the source is `"binance_trading"` — it never contains those words. The actual environment (testnet/live) is not encoded in the source string.
2. **Symbol shows "TRADE_UPDATES"**: For trading streams like `trade_updates` or `user_data_stream`, these are account-wide channels with no symbol — but `parseStreamName` treats the entire stream name as a symbol.
3. **Event Type shows "unknown"**: `trade_updates` has no `@` separator, so `parseStreamName` falls into the `atIndex === -1` branch and returns `"unknown"`.

## Plan

### File 1: `src/utils/streamNameParser.ts`

**Add well-known trading stream detection**:
- Add a set of known trading/account-wide stream names: `trade_updates`, `user_data_stream`
- In `parseStreamName`: if stream name matches a known trading stream, return `{ symbol: "", eventType: "order_update" }` (empty symbol, correct type)
- In `getEventTypeLabel`: add `order_update: "Order Updates (Fills)"` to the labels map

**Fix environment**: `getEnvironment` cannot determine the environment from source alone. Add an optional `environment` parameter to `StreamBadgeWithTooltip` props that gets passed through from the subscription data (which already has this info from the node config). If not provided, fall back to current source-string logic.

### File 2: `src/components/market/StreamBadgeWithTooltip.tsx`

- Add optional `environment` prop to the interface
- Use the prop if provided, otherwise fall back to `getEnvironment(source)`
- When `parsed.symbol` is empty (trading stream), hide the Symbol row entirely
- Display event type as "Order Updates (Fills)" for trading streams

### File 3: `src/pages/MarketSubscriptions.tsx`

- Pass the `environment` field from subscription data to `StreamBadgeWithTooltip` if available in the API response

## Result

- Trading streams show: no Symbol row, Event Type = "Order Updates (Fills)", correct environment
- Market streams: unchanged behavior
- Environment reflects actual node config when available

