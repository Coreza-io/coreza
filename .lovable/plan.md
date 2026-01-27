

## Plan: Simplify GatewayConfig to 2-Parameter Stream-Based Signature

### Current State

The `GatewayConfig` interface defines:
```typescript
makeSubscribeMessage: (symbols: string[], types?: string[], options?: SubscribeOptions, source?: string) => any;
makeUnsubscribeMessage: (symbols: string[], types?: string[], options?: SubscribeOptions, source?: string) => any;
```

But the Binance config is already using a simplified version:
```typescript
makeSubscribeMessage: (stream, _source) => buildBinanceSubscribeMessage(stream)
```

### Proposed Change

Update the `GatewayConfig` interface to use the new stream-based signature:

```typescript
// NEW: Stream-based signature (native stream names)
makeSubscribeMessage: (streamNames: string[], source?: string) => any;
makeUnsubscribeMessage: (streamNames: string[], source?: string) => any;
```

---

## Files to Update

### 1. `market-stream-service/src/marketGateways/types.ts`

Update the interface signature:

```typescript
// Subscription management - streamNames are native broker format (btcusdt@kline_1m, bars.AAPL)
makeSubscribeMessage: (streamNames: string[], source?: string) => any;
makeUnsubscribeMessage: (streamNames: string[], source?: string) => any;
```

---

### 2. `market-stream-service/src/marketGateways/binance/config.ts`

Already correct - uses `(stream, _source)`:
```typescript
makeSubscribeMessage: (stream, _source) => buildBinanceSubscribeMessage(stream),
makeUnsubscribeMessage: (stream, _source) => buildBinanceUnsubscribeMessage(stream),
```

---

### 3. `market-stream-service/src/marketGateways/alpaca/config.ts`

Update to parse stream names internally:

```typescript
makeSubscribeMessage: (streamNames, source) => {
  // Parse stream names to extract symbols and types
  // e.g., "bars.AAPL" → symbol: "AAPL", type: "bars"
  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  return buildAlpacaSubscribeMessage(symbols, types, source);
},
makeUnsubscribeMessage: (streamNames, source) => {
  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  return buildAlpacaUnsubscribeMessage(symbols, types, source);
},
```

Or update `buildAlpacaSubscribeMessage` to accept stream names directly.

---

### 4. `market-stream-service/src/marketGateways/dhan/config.ts`

Update signature (Dhan already only uses symbols):

```typescript
makeSubscribeMessage: (streamNames, _source) => {
  // Dhan stream names are just symbols, extract them
  const symbols = streamNames.map(s => extractDhanSymbol(s));
  return buildDhanSubscribeMessage(symbols);
},
makeUnsubscribeMessage: (streamNames, _source) => {
  const symbols = streamNames.map(s => extractDhanSymbol(s));
  return buildDhanUnsubscribeMessage(symbols);
},
```

---

### 5. `market-stream-service/src/services/MarketDataGateway.ts`

Update the calls to use simplified signature:

```typescript
// Line 256 (subscribeStreams)
const msg = this.config.makeSubscribeMessage(newStreams, this.source);

// Line 279 (unsubscribeStreams)  
const msg = this.config.makeUnsubscribeMessage(streamNames, this.source);

// Line 293 (resubscribeAll)
const msg = this.config.makeSubscribeMessage(streams, this.source);
```

---

## Technical Details

### Alpaca Stream Name Parsing

For Alpaca, stream names are formatted as `{type}.{SYMBOL}`:
- `bars.AAPL` → type: `bars`, symbol: `AAPL`
- `trades.MSFT` → type: `trades`, symbol: `MSFT`
- `news.AAPL` → type: `news`, symbol: `AAPL`

Helper function needed:
```typescript
function parseAlpacaStreamNames(streamNames: string[]): { symbols: string[], types: string[] } {
  const symbols = new Set<string>();
  const types = new Set<string>();
  
  for (const name of streamNames) {
    const [type, symbol] = name.split('.');
    if (type && symbol) {
      types.add(type);
      symbols.add(symbol);
    }
  }
  
  return { 
    symbols: Array.from(symbols), 
    types: Array.from(types) 
  };
}
```

### Dhan Stream Name Parsing

For Dhan, stream names might just be the symbol/instrument ID. The helper extracts the symbol from whatever format is used.

---

## Summary of Changes

| File | Change |
|------|--------|
| `types.ts` | Update interface to `(streamNames: string[], source?: string)` |
| `binance/config.ts` | Already correct |
| `alpaca/config.ts` | Add stream name parsing before calling helper |
| `dhan/config.ts` | Add stream name parsing before calling helper |
| `MarketDataGateway.ts` | Use simplified 2-param calls |

---

## Benefits

1. **Clean interface** - Only pass what's needed: stream names and source
2. **Stream names as first-class citizens** - Matches the new architecture
3. **Gateway-specific parsing** - Each gateway handles its own format internally
4. **Removes unused parameters** - No more `types`, `options` passed through

