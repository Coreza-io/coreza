

# Binance order_update End-to-End Verification

## How Binance User Data Stream Works (per official docs)

1. **Create listenKey**: `POST /api/v3/userDataStream` (spot) or `POST /fapi/v1/listenKey` (futures) with `X-MBX-APIKEY` header
2. **Connect WebSocket**: `wss://stream.binance.com:9443/ws/{listenKey}` — no subscription message needed, all account events auto-stream
3. **Keep alive**: `PUT` to same endpoint every <60 minutes (validity = 60 min)
4. **Event types**: `executionReport` (spot orders), `ORDER_TRADE_UPDATE` (futures orders), plus `outboundAccountPosition`, `balanceUpdate`, `ACCOUNT_UPDATE`

## Our Implementation vs Binance Docs

| Aspect | Binance Docs | Our Implementation | Status |
|---|---|---|---|
| listenKey creation | POST with `X-MBX-APIKEY` | `preConnectBinance()` — correct endpoint, correct header | Correct |
| Spot endpoint | `/api/v3/userDataStream` | Correct | Correct |
| Futures endpoint | `/fapi/v1/listenKey` | Correct | Correct |
| WS URL (spot) | `wss://stream.binance.com:9443/ws/{listenKey}` | Correct in `getBinanceWsUrl()` | Correct |
| WS URL (futures) | `wss://fstream.binance.com/ws/{listenKey}` | Correct | Correct |
| Testnet URLs | `testnet.binance.vision` / `testnet.binancefuture.com` | Correct | Correct |
| keepalive | PUT every <60 min | PUT every 30 min | Correct (safe margin) |
| No subscribe msg needed | User Data Stream auto-sends | `buildBinanceSubscribeMessage()` returns `null` for trading | Correct |
| Spot order event | `executionReport` | Handled in `normalizeBinanceMessage()` | Correct |
| Futures order event | `ORDER_TRADE_UPDATE` | Handled, uses `msg.o` sub-object | Correct |
| Spot fields | `i`=orderId, `S`=side, `x`=execType, `X`=status, `z`=cumQty, `Z`=cumQuoteQty | All mapped correctly | Correct |
| Futures fields | `o.i`, `o.S`, `o.x`, `o.X`, `o.z`, `o.ap` (avg price) | All mapped correctly | Correct |
| Publish filter | Only order events | `shouldPublishBinanceMessage` checks `executionReport` + `ORDER_TRADE_UPDATE` | Correct |
| Redis channel | Fixed name | `md:symbol:user_data_stream` | Correct |

## Bug Found: listenKey Refresh Interval Never Cleared

`preConnectBinance()` creates a `setInterval` for 30-minute keepalive and stores it as `_listenKeyRefreshInterval` on the credentials object. However, when the gateway disconnects (`disconnect()` method), only the WebSocket ping keepalive is cleared — the listenKey refresh interval is **never cleared**.

This causes:
- **Memory leak**: Orphaned intervals keep running after disconnect
- **Unnecessary API calls**: PUT requests to refresh a listenKey that's no longer in use
- **Errors on reconnect**: A new interval is created on reconnect (via `preConnect`), but the old one persists

### Fix

In `MarketDataGateway.ts`, the `disconnect()` method needs to clear the `_listenKeyRefreshInterval` from `this.credentials`:

```text
disconnect() {
  this.stopKeepalive();
  // Clear Binance listenKey refresh interval if present
  if (this.credentials?._listenKeyRefreshInterval) {
    clearInterval(this.credentials._listenKeyRefreshInterval);
  }
  if (this.ws) { ... }
}
```

Same cleanup should happen in the `close` event handler (line 117-131) before `handleReconnect()`, since reconnect will call `preConnect` again and create a new interval.

## Summary

| Component | Verdict |
|---|---|
| listenKey lifecycle (create, refresh, WS URL) | Correct |
| Event filtering (executionReport, ORDER_TRADE_UPDATE) | Correct |
| Normalization (spot + futures field mapping) | Correct |
| Redis routing (fixed `user_data_stream` channel) | Correct |
| Subscribe/unsubscribe (returns null for trading) | Correct |
| Route splitting (stream.ts register + subscribe) | Correct (after recent fix) |
| **listenKey refresh interval cleanup** | **Bug — interval never cleared on disconnect** |

## Files to Edit

| File | Change |
|---|---|
| `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts` | Clear `_listenKeyRefreshInterval` in `disconnect()` and in the WebSocket `close` handler before reconnect |

