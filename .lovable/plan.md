# Plan: Refactor to Use Stream Names as Primary Tracking Unit

## Status: ✅ COMPLETED

Refactored the market data tracking system to use native stream names (e.g., `btcusdt@kline_1m`, `bars.AAPL`) as the single source of truth, replacing the redundant `symbols + symbolTypes` tracking.

## Changes Made

### MarketControlHandler.ts
- ✅ Updated `SourceState` interface: Replaced `symbols: Set<string>` and `symbolTypes: Map<string, Set<string>>` with `streams: Set<string>`
- ✅ Updated `handleSubscribe`: Builds stream names first, checks for duplicates via simple set membership, stores in `state.streams`
- ✅ Updated `handleUnsubscribe`: Removes stream names from `state.streams` and Redis
- ✅ Updated `connectGateway`: Initializes with empty `streams: Set<string>()`
- ✅ Updated `persistState`: Stores `streams` array directly (native stream names)
- ✅ Updated `restoreFromRedis`: Restores streams directly, includes backward compatibility migration for old `symbolTypes` format
- ✅ Updated `getStats`: Returns `streamCount` and `streams` instead of `symbolCount` and `symbols`

### MarketDataGateway.ts
- ✅ Replaced `subscribedSymbolTypes: Map<string, Set<string>>` with `subscribedStreams: Set<string>`
- ✅ Added `subscribeStreams(streamNames: string[])` - primary subscription method using native stream names
- ✅ Added `unsubscribeStreams(streamNames: string[])` - primary unsubscription method
- ✅ Kept legacy `subscribeSymbols()` and `unsubscribeSymbols()` for backward compatibility (delegates to stream-based methods)
- ✅ Added helper methods: `extractSymbolsFromStreams()`, `extractTypesFromStreams()`, `buildStreamNameForSymbol()`
- ✅ Updated `resubscribeAll()`: Uses streams directly
- ✅ Updated `getStats()`: Returns `subscribedStreams` instead of symbol-type pairs

## Benefits Achieved

1. **Single source of truth** - One set of stream names, no conversion needed
2. **Simpler duplicate detection** - `state.streams.has(streamName)` vs looping through symbols/types
3. **Direct gateway passthrough** - Stream names flow from control message → state → gateway → broker
4. **Cleaner restoration** - Stored format = runtime format = broker format
5. **Less code** - Removed symbol/type grouping logic
6. **Backward compatible** - Legacy `subscribeSymbols()` still works, old Redis state is migrated

