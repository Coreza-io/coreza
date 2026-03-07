

# Plan: Single AlpacaStreamData Node Emitting Both Market Data + Order Updates

## Problem

The user wants one `AlpacaStreamData` node to connect to **both** Alpaca WebSocket endpoints (market data + trading updates) and emit all events through the same output. An `If` node downstream routes based on event type.

## Architecture Challenge

The current system creates **one gateway instance per source key** (e.g., `alpaca_market` = one WS connection). Alpaca's market data and trading updates live on **separate WebSocket endpoints**:
- Market: `wss://stream.data.alpaca.markets/v2/{feed}`
- Trading: `wss://paper-api.alpaca.markets/stream`

A single `sourceId` can only spawn one connection. We need the activation flow to spawn **two** gateway instances and register the workflow to receive events from both.

## Approach: Companion Gateway Pattern

When `AlpacaStreamData` activates (with `data_type=market`), the activation code **also** spawns an `alpaca_trading` gateway and registers the workflow to receive `order_update` events from it. Both gateways publish to Redis; the subscriber routes both event types to the same workflow's Redis Stream.

```text
                       ┌── alpaca_market gateway ──→ Redis md:symbol:aapl@trade_undefined
AlpacaStreamData ──────┤                                        │
(single node)          └── alpaca_trading gateway ──→ Redis md:symbol:*@order_update_undefined
                                                                │
                       MarketDataSubscriber routes BOTH ────────┘
                                    │
                              LiveStrategyRunner
                                    │
                                 If Node
                              ┌─────┴─────┐
                         type=bar     type=order_update
                              │           │
                          Strategy    PortfolioUpdate
```

## Changes

### 1. Add `order_update` to MarketEventType + order fields
**`coreza-backend/market-stream-service/src/types/marketEvent.ts`**

- Add `"order_update"` to `MarketEventType` union
- Add fields: `orderEvent?: string`, `orderId?: string`, `side?: string`, `filledQty?: number`, `filledAvgPrice?: number`, `orderStatus?: string`, `orderSymbol?: string`

### 2. Add `alpaca_trading` to SOURCE_MAPPING
**`coreza-backend/market-stream-service/src/marketGateways/index.ts`**

```typescript
alpaca_trading: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
```

### 3. Update Alpaca helpers for trading WebSocket
**`coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts`**

- `getAlpacaWsUrl`: Add `alpaca_trading` → `wss://paper-api.alpaca.markets/stream` (paper) or `wss://api.alpaca.markets/v2/trading/stream` (live)
- `buildAlpacaSubscribeMessage`: `alpaca_trading` → `{ action: "listen", data: { streams: ["trade_updates"] } }`
- `buildAlpacaUnsubscribeMessage`: `alpaca_trading` → no-op (Alpaca doesn't support unsubscribing from trade_updates)
- `isAlpacaAuthSuccess`: Handle trading stream format: `{ stream: "authorization", data: { status: "authorized" } }`
- `isAlpacaAuthError`: Handle trading stream auth error format
- `shouldPublishAlpacaMessage`: `alpaca_trading` → publish when `stream === "trade_updates"`
- `normalizeAlpacaMessage`: `alpaca_trading` → normalize to `CorezaMarketEvent` with `type: "order_update"`, extracting `orderId`, `side`, `filledQty`, `filledAvgPrice`, `orderStatus` from Alpaca's trade_update payload

### 4. Workflow activation spawns companion trading gateway
**`coreza-backend/src/routes/workflow.ts`** (activation section, ~line 525-572)

After the existing `publishRegisterWorkflow` call for `alpaca_market`, add logic:

```typescript
// If source is alpaca_market, also register for trading updates
if (sourceId === 'alpaca_market') {
  // Register workflow to also receive alpaca_trading events
  await RegistrationService.publishRegisterWorkflow({
    userId,
    workflowId,
    nodeId: triggerNode.id,
    source: 'alpaca_trading',
    scope,
    onlyClosedBars: false,
  });

  // Subscribe to trading stream (connects the trading WS gateway)
  await SubscriptionService.subscribe({
    source: 'alpaca_trading',
    userId,
    workflowId,
    symbols: ['*'], // trade_updates covers all symbols
    credentialId: nodeValues.credential_id,
    scope,
    targetWorkflowId: workflowId,
  });
}
```

### 5. Handle companion cleanup on deactivation/delete
**`coreza-backend/src/routes/workflow.ts`** (deactivation + delete sections)

When deactivating/deleting an `alpaca_market` workflow, also unsubscribe/unregister `alpaca_trading`.

### 6. Trading stream name convention
The trading gateway will use stream name `*@order_update_undefined` (wildcard symbol since trade_updates covers all orders). The `buildStreamNames` utility and subscriber need to handle this — or alternatively use a fixed stream name like `trade_updates.account` that the subscriber subscribes to.

**`coreza-backend/market-stream-service/src/utils/streamName.ts`** — Add handling for `alpaca_trading` source to produce a fixed stream name pattern.

### 7. Update MarketDataSubscriber event formatting
**`coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts`**

Add `order_update` formatting in `formatMarketEventPayload`:
```typescript
if (type === "order_update") {
  return {
    data: {
      type: "order_update",
      symbol: event.symbol,
      order: {
        event: event.orderEvent,
        orderId: event.orderId,
        side: event.side,
        filledQty: event.filledQty,
        filledAvgPrice: event.filledAvgPrice,
        status: event.orderStatus,
      }
    }
  };
}
```

### 8. Update AlpacaStreamData.json description
**`src/nodes/AlpacaStreamData.json`**

Update description to mention that when `data_type=market`, the node also automatically streams order fill events for the account.

## File Summary

| File | Change |
|---|---|
| `market-stream-service/.../types/marketEvent.ts` | Add `order_update` type + order fields |
| `market-stream-service/.../marketGateways/index.ts` | Add `alpaca_trading` source mapping |
| `market-stream-service/.../alpaca/helpers.ts` | Add trading WS URL, auth, subscribe, normalize for order updates |
| `coreza-backend/src/routes/workflow.ts` | Spawn companion `alpaca_trading` gateway on activation; cleanup on deactivation/delete |
| `market-stream-service/.../utils/streamName.ts` | Handle `alpaca_trading` stream name pattern |
| `market-stream-service/.../MarketDataSubscriber.ts` | Add `order_update` formatting case |
| `src/nodes/AlpacaStreamData.json` | Update description |

