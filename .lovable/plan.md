

# Fix: Binance Trading Stream — Two Bugs

## Bug 1: `creds.api_secret` is `undefined` (the crash)

**Root cause**: `buildBinanceAuthMessage` at line 138 uses `creds.api_secret`, but Binance credentials are stored with the field name `secret_key` (confirmed in `credentialValidator.ts` and all usages in `brokers/binance/http/operations.ts`).

**Fix in `coreza-backend/market-stream-service/src/marketGateways/binance/helpers.ts`** (line 138):

Change:
```typescript
const signature = createHmac("sha256", creds.api_secret)
```
To:
```typescript
const signature = createHmac("sha256", creds.secret_key)
```

Also add a guard before signing to prevent cryptic Node.js errors:
```typescript
if (!creds.secret_key) {
  throw new Error("Binance secret_key is missing from credentials — cannot sign auth message");
}
```

## Bug 2: Null subscribe/unsubscribe messages sent to WebSocket

**Root cause**: For `binance_trading`, `makeSubscribeMessage` and `makeUnsubscribeMessage` return `null` (by design — User Data Stream auto-sends events). But `MarketDataGateway` calls `JSON.stringify(null)` and sends `"null"` to the WebSocket.

**Fix in `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts`** — Add null guards in three places:

**`subscribeStreams()`** (lines 281-283):
```typescript
const msg = this.config.makeSubscribeMessage(newStreams, this.source);
if (msg !== null && msg !== undefined) {
  const payload = this.encodeMessage(msg);
  this.ws.send(payload);
}
```

**`unsubscribeStreams()`** (lines 304-306):
```typescript
const msg = this.config.makeUnsubscribeMessage(streamNames, this.source);
if (msg !== null && msg !== undefined) {
  const payload = this.encodeMessage(msg);
  this.ws.send(payload);
}
```

**`resubscribeAll()`** (lines 318-320):
```typescript
const msg = this.config.makeSubscribeMessage(streams, this.source);
if (msg !== null && msg !== undefined) {
  const payload = this.encodeMessage(msg);
  this.ws?.send(payload);
}
```

## PDF Recommendations (incorporated)

Per the PDF review:
- The HMAC approach is correct for HMAC keys (which is what Coreza uses). A comment should note that RSA/Ed25519 keys would need different signing logic.
- Control frames (`{ id, status, result }`) vs event frames (`{ subscriptionId, event }`) — already handled correctly by `isBinanceAuthSuccess`, `isBinanceAuthError`, `handleBinanceControlMessage`, and `unwrapBinanceUserDataEnvelope`.
- Futures stays on REST listenKey — already implemented correctly.

## Files Changed

| File | Change |
|------|--------|
| `coreza-backend/market-stream-service/src/marketGateways/binance/helpers.ts` | Fix `api_secret` → `secret_key`, add guard |
| `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts` | Add null guards in `subscribeStreams`, `unsubscribeStreams`, `resubscribeAll` |

