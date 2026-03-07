

# Plan: Single AlpacaStreamData Node Emitting Both Market Data + Order Updates

## Status: ✅ IMPLEMENTED

## Summary

Implemented the Companion Gateway Pattern so a single `AlpacaStreamData` trigger node connects to both Alpaca WebSocket endpoints (market data + trading) and emits all events through the same output.

## Changes Made

### 1. Added `order_update` to MarketEventType + order fields
- `coreza-backend/market-stream-service/src/types/marketEvent.ts` — Added `"order_update"` to union, added `orderEvent`, `orderId`, `side`, `filledQty`, `filledAvgPrice`, `orderStatus`, `orderSymbol` fields, plus news fields (`headline`, `summary`, etc.)
- `coreza-backend/src/types/marketEvent.ts` — Same additions to main backend types

### 2. Added `alpaca_trading` to SOURCE_MAPPING
- `coreza-backend/market-stream-service/src/marketGateways/index.ts` — Added `alpaca_trading` source mapping

### 3. Updated Alpaca helpers for trading WebSocket
- `coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts` — Full rewrite with:
  - `getAlpacaWsUrl`: Added `alpaca_trading` → `wss://paper-api.alpaca.markets/stream` (paper) or `wss://api.alpaca.markets/stream` (live)
  - `buildAlpacaSubscribeMessage`: `alpaca_trading` → `{ action: "listen", data: { streams: ["trade_updates"] } }`
  - `buildAlpacaUnsubscribeMessage`: `alpaca_trading` → returns `null` (no-op)
  - `isAlpacaAuthSuccess/Error`: Handle both market data and trading stream auth response formats
  - `shouldPublishAlpacaMessage`: `alpaca_trading` → publish when `stream === "trade_updates"`
  - `normalizeAlpacaMessage`: `alpaca_trading` → normalize to `CorezaMarketEvent` with `type: "order_update"`

### 4. Updated GatewayConfig types + MarketDataGateway
- `coreza-backend/market-stream-service/src/marketGateways/types.ts` — Added `source?` param to `makeAuthMessage`, `isAuthSuccess`, `isAuthError`
- `coreza-backend/market-stream-service/src/marketGateways/alpaca/config.ts` — Pass `source` through to auth functions
- `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts` — Pass `this.source` to auth function calls

### 5. Updated streamName utility
- `coreza-backend/market-stream-service/src/utils/streamName.ts` — Added `alpaca_trading` handling: `buildStreamName` returns fixed `"trade_updates"`, `parseStreamName` returns `{ symbol: "*", eventType: "order_update" }`

### 6. Updated MarketDataSubscriber
- `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts` — 
  - Message handler now checks `trade_updates` stream name for order_update routing
  - Added `order_update` formatting in `formatMarketEventPayload`

### 7. Companion gateway activation/deactivation
- `coreza-backend/src/routes/workflow.ts` — 
  - On activation: if `sourceId === "alpaca_market"`, also registers `alpaca_trading` and subscribes with `symbols: ["*"]`
  - On deactivation: if source is `alpaca_market`, also unregisters/unsubscribes the companion trading gateway

### 8. Updated AlpacaStreamData.json description
- `src/nodes/AlpacaStreamData.json` — Updated description to mention automatic order fill streaming

## Workflow Shape

```text
                           ┌──── type === "bar" ────→ Strategy ──→ Buy/Sell
AlpacaStreamData ──→ If ──┤
                           └──── type === "order_update" ──→ PortfolioUpdate
```
