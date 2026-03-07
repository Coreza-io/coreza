

# Analysis: Alpaca Crypto Streaming (BTC/USD) — What's Missing

## How Alpaca Crypto Streaming Works

Alpaca has a **completely separate WebSocket endpoint** for crypto:

| Asset | WebSocket URL | Symbol Format |
|---|---|---|
| Stocks | `wss://stream.data.alpaca.markets/v2/{feed}` | `AAPL`, `TSLA` |
| Crypto | `wss://stream.data.alpaca.markets/v1beta3/crypto/us` | `BTC/USD`, `ETH/USD` |

Key differences:
- **No feed parameter** — crypto has no iex/sip distinction, it uses a fixed `/crypto/us` path
- **Slash in symbol** — crypto uses `BTC/USD` format (not `BTCUSD`)
- **24/7 streaming** — no market hours
- **Same auth** — identical `{action: "auth", key, secret}` message
- **Same subscribe format** — `{action: "subscribe", trades: ["BTC/USD"], bars: ["BTC/USD"]}` 
- **Same message types** — `t` (trade), `q` (quote), `b` (bar), `d` (daily bar) — identical to stocks
- **Additional channel**: `orderbooks` (unique to crypto) and `updatedBars`

## Current State — What We Have

### Frontend Nodes
- `AlpacaStreamData.json` and `AlpacaSubscribe.json` have `data_type` with options: `market` | `news`
- No `crypto` option exists
- Feed selector shows `iex` / `sip` / `test` — none apply to crypto
- Symbol placeholder says "AAPL, TSLA" — no mention of crypto format

### Backend — URL Builder (`helpers.ts`)
```typescript
// Current logic — NO crypto path
const feed = creds.feed || "iex";
return `wss://stream.data.alpaca.markets/v2/${feed}`;
```
If user selects `data_type: "market"` and types `BTC/USD`, it connects to the **stock** endpoint which will reject crypto symbols silently (no data, or error).

### Backend — Source Resolution (`workflow.ts`)
```typescript
resolveStreamSourceId → `${subCategory}_${dataType}` → "alpaca_market"
```
There's no `alpaca_crypto` source ID anywhere in the system.

### Backend — Stream Names (`streamName.ts`)
Uses `symbol@eventType` universal format. `BTC/USD` contains a slash which won't break the format but needs testing. The `/` in `btc/usd@trade` is unusual but functional.

### Backend — SOURCE_MAPPING (`marketGateways/index.ts`)
No `alpaca_crypto` entry exists. It would fall through to the default mapper.

### Backend — Streaming Types (`streaming.ts`)
```typescript
feed?: "iex" | "sip" | "test";  // No crypto-specific value
```

## What's Missing — Complete Gap List

### 1. Frontend Nodes (AlpacaStreamData.json + AlpacaSubscribe.json)
- Add `data_type` option: `{ id: "crypto", name: "Crypto (BTC/USD, ETH/USD)" }`
- Feed selector should **hide** when `data_type === "crypto"` (crypto has no feed choice)
- Update symbol placeholder conditionally for crypto: `"BTC/USD, ETH/USD"`
- Optionally add `orderbooks` to stream_types when crypto is selected

### 2. Backend — URL Builder (`helpers.ts`)
Add crypto source handling:
```typescript
if (source === "alpaca_crypto") {
  return "wss://stream.data.alpaca.markets/v1beta3/crypto/us";
}
```

### 3. Backend — Source Resolution (`workflow.ts`)
`resolveStreamSourceId` already computes `alpaca_crypto` automatically when `subCategory="alpaca"` and `data_type="crypto"` → produces `"alpaca_crypto"`. No change needed here.

### 4. Backend — SOURCE_MAPPING (`marketGateways/index.ts`)
Add entry:
```typescript
alpaca_crypto: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
```

### 5. Backend — Streaming Types (`streaming.ts`)
No change needed — `feed` is optional and crypto won't send one.

### 6. Backend — Normalization (`helpers.ts`)
No change needed — crypto uses identical message types (`t`, `q`, `b`, `d`) with same field names. The normalizer already handles them.

### 7. Backend — Companion Trading Gateway
In `stream.ts` and `workflow.ts`, companion trading registration checks:
```typescript
if (sourceId === "alpaca_market" || sourceId === "binance_market")
```
Should also include `"alpaca_crypto"` so crypto traders get order fill events too.

## Summary of Changes Required

| Layer | File | Change | Effort |
|---|---|---|---|
| Frontend | `AlpacaStreamData.json` | Add `crypto` data_type, hide feed for crypto, add orderbooks stream type | Small |
| Frontend | `AlpacaSubscribe.json` | Add `crypto` data_type, hide feed for crypto | Small |
| Backend | `market-stream-service/.../alpaca/helpers.ts` | Add `alpaca_crypto` URL routing | 1 line |
| Backend | `market-stream-service/.../index.ts` | Add `alpaca_crypto` to SOURCE_MAPPING | 1 line |
| Backend | `src/routes/stream.ts` | Add `alpaca_crypto` to companion trading check | 1 line |
| Backend | `src/routes/workflow.ts` | Add `alpaca_crypto` to companion trading check | 2 lines |
| Backend | `src/types/streaming.ts` | No change needed | — |

Total: 6 files, all small targeted edits. Auth, subscribe format, message parsing, and normalization all work as-is because Alpaca crypto uses the same protocol — only the WebSocket URL differs.

