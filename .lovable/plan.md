

# Plan: Binance Order Fill Streaming via Companion Gateway Pattern

## Overview

Mirror the Alpaca companion gateway pattern for Binance. When `BinanceStreamData` activates (source: `binance_market`), the system also spawns a `binance_trading` companion gateway connecting to Binance's **User Data Stream** WebSocket. Both market data and order fill events flow to the same workflow, routable via an `If` node.

## Binance User Data Stream — Key Differences from Alpaca

Binance's User Data Stream requires a **listenKey** obtained via REST API before connecting:

1. **Spot**: `POST /api/v3/userDataStream` → returns `{ listenKey: "..." }` → connect to `wss://stream.binance.com:9443/ws/{listenKey}`
2. **Futures**: `POST /fapi/v1/listenKey` → returns `{ listenKey: "..." }` → connect to `wss://fstream.binance.com/ws/{listenKey}`
3. **Testnet Spot**: `POST https://testnet.binance.vision/api/v3/userDataStream` → `wss://stream.testnet.binance.vision/ws/{listenKey}`
4. **Testnet Futures**: `POST https://testnet.binancefuture.com/fapi/v1/listenKey` → `wss://stream.testnet.binancefuture.com/ws/{listenKey}`

The listenKey must be **refreshed every 30 minutes** (`PUT` to same endpoint) or it expires after 60 minutes. No WebSocket-level auth message needed — the listenKey in the URL handles authentication.

Order events arrive as `executionReport` (spot) or `ORDER_TRADE_UPDATE` (futures) with fields like `s` (symbol), `S` (side), `X` (order status), `l` (last filled qty), `L` (last filled price), `z` (cumulative filled qty), `Z` (cumulative quote qty).

This maps perfectly to the existing `preConnect` + `requiresPreConnect` pattern already used by Schwab.

## Changes

### 1. Register `binance_trading` source
**`coreza-backend/market-stream-service/src/marketGateways/index.ts`**

Add:
```typescript
binance_trading: { credentialServiceType: 'binance', gatewaySource: 'binance' },
```

### 2. Update Binance gateway config — add `source` passthrough
**`coreza-backend/market-stream-service/src/marketGateways/binance/config.ts`**

- Pass `source` param through to all helper functions (matching Alpaca pattern)
- Add `requiresPreConnect` conditional on source (only for `binance_trading`)
- Add `preConnect` that fetches listenKey via REST API
- Add `makeAuthMessage`: return `null` for trading (no WS auth needed — listenKey handles it)

### 3. Update Binance helpers — add trading stream support
**`coreza-backend/market-stream-service/src/marketGateways/binance/helpers.ts`**

- **`getBinanceWsUrl(creds, source)`**: For `binance_trading`, return `wss://stream.binance.com:9443/ws/{listenKey}` (listenKey comes from preConnect result in creds)
- **`preConnectBinance(creds)`**: REST call to `POST /api/v3/userDataStream` (spot) or `POST /fapi/v1/listenKey` (futures) with API key header. Returns `{ ...creds, listenKey }`. Also sets up a 30-min interval to `PUT` and refresh the listenKey.
- **`buildBinanceSubscribeMessage(stream, source)`**: For `binance_trading`, return `null` (no subscription needed — User Data Stream auto-sends all account events)
- **`shouldPublishBinanceMessage(msg, source)`**: For `binance_trading`, publish when `msg.e === "executionReport"` (spot) or `msg.e === "ORDER_TRADE_UPDATE"` (futures)
- **`normalizeBinanceMessage(msg, source)`**: For `binance_trading`, normalize `executionReport` / `ORDER_TRADE_UPDATE` to `CorezaMarketEvent` with `type: "order_update"`:
  - `orderId`: `msg.i` (spot) or `msg.o.i` (futures)
  - `side`: `msg.S` (spot) or `msg.o.S` (futures)
  - `filledQty`: `parseFloat(msg.z)` (cumulative filled)
  - `filledAvgPrice`: `parseFloat(msg.Z) / parseFloat(msg.z)` (avg price from cumulative quote/qty)
  - `orderStatus`: `msg.X` (spot) or `msg.o.X` (futures) — mapped to standard: `FILLED`→`filled`, `PARTIALLY_FILLED`→`partially_filled`, `CANCELED`→`canceled`
  - `orderEvent`: derived from `msg.x` execution type: `TRADE`→`fill`, `CANCELED`→`canceled`, `REJECTED`→`rejected`, `NEW`→`new`

### 4. Update stream name utilities
**`coreza-backend/market-stream-service/src/utils/streamName.ts`**

Add `binance_trading` handling (same pattern as `alpaca_trading`):
- `buildStreamName`: return `"user_data_stream"` (fixed name)
- `parseStreamName`: return `{ symbol: "*", eventType: "order_update" }`

### 5. Workflow activation — spawn companion for Binance
**`coreza-backend/src/routes/workflow.ts`**

In the activation section (~line 562), extend the existing Alpaca companion block:
```typescript
if (sourceId === "alpaca_market" || sourceId === "binance_market") {
  const tradingSource = sourceId === "alpaca_market" ? "alpaca_trading" : "binance_trading";
  // ... same registration + subscription logic with tradingSource
}
```

In the deactivation section (~line 757), extend similarly:
```typescript
if (deactivateSourceId === "alpaca_market" || deactivateSourceId === "binance_market") {
  const tradingSource = deactivateSourceId === "alpaca_market" ? "alpaca_trading" : "binance_trading";
  // ... same unregister + unsubscribe logic
}
```

### 6. Manual execution — spawn companion for Binance
**`coreza-backend/src/routes/stream.ts`**

In the `/:source/register` handler (~line 455), extend:
```typescript
if (sourceId === "alpaca_market" || sourceId === "binance_market") {
  const tradingSource = sourceId === "alpaca_market" ? "alpaca_trading" : "binance_trading";
  // ... same companion registration logic
}
```

In the `/unregister` handler (~line 550), extend:
```typescript
if (listener?.source === "alpaca_market" || listener?.source === "binance_market") {
  const tradingSource = listener.source === "alpaca_market" ? "alpaca_trading" : "binance_trading";
  // ... same companion cleanup logic
}
```

### 7. Update BinanceStreamData.json description
**`src/nodes/BinanceStreamData.json`**

Update description to mention that market data mode also automatically streams order fill events.

## File Summary

| File | Change |
|---|---|
| `market-stream-service/.../marketGateways/index.ts` | Add `binance_trading` source mapping |
| `market-stream-service/.../binance/config.ts` | Pass `source` to helpers, add `preConnect` + `requiresPreConnect` for trading |
| `market-stream-service/.../binance/helpers.ts` | Add trading WS URL (listenKey), preConnect (REST listenKey fetch + refresh), subscribe (no-op), shouldPublish, normalize for `executionReport`/`ORDER_TRADE_UPDATE` |
| `market-stream-service/.../utils/streamName.ts` | Add `binance_trading` stream name handling |
| `coreza-backend/src/routes/workflow.ts` | Extend companion gateway logic for `binance_market` (activate + deactivate) |
| `coreza-backend/src/routes/stream.ts` | Extend companion gateway logic for `binance_market` (register + unregister) |
| `src/nodes/BinanceStreamData.json` | Update description |

