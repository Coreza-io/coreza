# Unify Dhan stream naming with the generic builder

## Goal

Make Dhan use the same generic `buildStreamName`/`buildStreamNames` path as every other broker, producing one common key in the shape `symbol@exchange@streamType` (e.g. `hdfcbank@nse_eq@full`). This single key is used for the Dhan gateway subscription, the Redis subscription set, and the Redis routing/publish channel. The numeric `securityId` is removed from the stream name and kept only in an in-memory `symbol <-> securityId` map seeded from the composite token `HDFCBANK:1333`. No Dhan-specific stream-name builder, routing-name function, routing-from-event function, or control-handler wrapper remains.

Note on casing: like the other brokers, the actual key follows the generic builder convention (lowercased, e.g. `hdfcbank@nse_eq@full`) so the gateway native name and the Redis routing key match exactly for pub/sub. The human-readable `HDFCBANK` is preserved on `event.symbol` for display/logging.

## Current vs target

```text
Current:
  control symbols : ["HDFCBANK:1333"]
  native name     : HDFCBANK@1333@NSE_EQ@full   (dhan-specific builder)
  routing key     : nse_eq:1333@full            (dhan-specific functions)

Target:
  control symbols : ["HDFCBANK:1333"]           (kept only to seed the map)
  common key      : hdfcbank@nse_eq@full        (generic builder, used everywhere)
  map (in memory) : NSE_EQ:HDFCBANK -> 1333  and  NSE_EQ:1333 -> HDFCBANK
```

## Changes

### 1. Add `exchange` to the generic stream-name builders
- `coreza-backend/market-stream-service/src/utils/streamName.ts`
  - `buildStreamName(source, symbol, streamType, interval?, contractType?, exchange?)`.
  - When `exchange` is provided, output `symbol@exchange@streamType` (and `symbol@exchange@streamType_interval` when interval is present); otherwise keep the existing `symbol@streamType` shape unchanged.
  - `buildStreamNames(source, symbols, streamTypes, interval, contractType?, exchange?)` forwards `exchange` to `buildStreamName` (and keeps lowercasing the symbol).
  - `parseStreamName(...)` recognizes the optional middle `exchange` segment so symbol/exchange/streamType round-trip cleanly.
- Mirror the same `exchange` support in `coreza-backend/src/utils/streamName.ts` and the builder/parser in `coreza-backend/src/brokers/capabilities.ts` (`buildStreamNameBySource` / `parseStreamNameBySource`) so backend and stream-service stay consistent.

### 2. Remove all Dhan-specific stream-naming functions
In `coreza-backend/market-stream-service/src/config/brokerStreamConfig.ts`:
- Delete from the `dhan` config: `buildStreamNames` (`buildMetadataStreamNames`), `toRoutingStreamName` (`toDhanRoutingStreamName`), and `buildRoutingKeyFromEvent` (`buildDhanRoutingKeyFromEvent`), plus the now-unused helpers.
- Keep `redactAuthMessage` and `companionSources`.
- Dhan now flows through the generic `buildStreamName`/routing path like the other brokers.

### 3. Remove the control-handler wrapper and use the generic builder directly
In `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`:
- Delete `buildMarketStreamNamesForControlMessage` (it is just a branch on the now-removed `cfg.buildStreamNames`; the generic `buildStreamNames` already covers every broker).
- At both call sites (subscribe ~line 764, unsubscribe ~line 931), call the generic `buildStreamNames(source, symbols, streamType || [], interval || "", contractType, exchange)` directly, threading `exchange` through.
- With Dhan's `toRoutingStreamName` gone, `getRoutingStreamNamesForControlMessage` becomes an identity for every broker (routing key == native name). Drop it too and use the native stream names directly for the Redis `:streams` set.

### 4. Seed the symbol/securityId map without a naming function
- Add a generic, optional hook on `BrokerStreamConfig`: `preprocessSubscriptionSymbols?(symbols, exchange) => string[]` (defaults to identity in common code).
- The `dhan` config implements it: split each `HDFCBANK:1333` token, register both map directions (`EXCHANGE:SYMBOL -> securityId` and `EXCHANGE:SECURITYID -> symbol`) in the Dhan helper maps, and return the plain symbols (`HDFCBANK`). `*` and numeric-only tokens pass through unchanged.
- `MarketControlHandler` applies this hook (when present) to `symbols` before calling the generic `buildStreamNames`, so common code stays broker-agnostic and the resulting names contain no securityId.

### 5. Update the Dhan gateway helpers to the new key shape
In `coreza-backend/market-stream-service/src/marketGateways/dhan/helpers.ts` (and mirror in `coreza-backend/src/brokers/dhan/ws/helpers.ts`):
- `parseDhanStreamName` parses the new `symbol@exchange@mode` (3-part) shape; keep backward-compatible parsing for legacy 2/4-part names during rollout.
- `buildDhanMarketMessages` resolves `SecurityId` for the Dhan JSON payload by looking up `EXCHANGE:SYMBOL` in the map (no securityId in the name anymore). If a symbol is numeric, use it directly as the securityId.
- `normalizeDhanMessage` keeps the O(1) reverse lookup (`EXCHANGE:SECURITYID -> symbol`) and sets `event.symbol` (display), `event.securityId`, `event.exchange`, `event.type`.
- `extractDhanSymbols` returns the leading symbol segment (already the case).

### 6. Generic routing includes exchange
In `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts`:
- Extend the generic `rawStream` construction so that when `event.exchange` is set, the key becomes `symbol@exchange@type` (lowercased), matching the stored subscription name. Brokers without `event.exchange` are unaffected.
- With the Dhan `buildRoutingKeyFromEvent`/`toRoutingStreamName` removed, the special-case branch at ~lines 326-329 collapses to the generic `rawStream`; Dhan now publishes to `hdfcbank@nse_eq@full`, identical to its subscription key.

### 7. Map durability across reconnect and restart
- The Dhan maps are module-level; ensure they are NOT cleared on socket disconnect so reconnect/`resubscribeAll` (which replays native names without securityId) can still resolve securityId.
- For process restart (`restoreFromRedis` replays persisted names that no longer carry securityId), rehydrate the map by re-resolving securityId from the Dhan scrip master once at startup for restored Dhan streams (one-time lookup, never per-tick). This preserves the "no per-tick DB lookup" rule.

### 8. Tests and downstream notes
- Update `coreza-backend/market-stream-service/tests/dhanOrderUpdate.test.ts`:
  - `buildStreamNames('dhan_stream', ['HDFCBANK'], ['ticker','quote'], '', undefined, 'NSE_EQ')` -> `['hdfcbank@nse_eq@ticker','hdfcbank@nse_eq@quote']`.
  - Routing key for a normalized event -> `hdfcbank@nse_eq@ticker` (same as the native name).
  - `buildDhanSubscribeMessage` still emits `{ RequestCode, ExchangeSegment, SecurityId }` resolved from the map.
- Re-check `registerWorkflowNativeStreams.test.ts` and `workflowScopeIsolation.test.ts` for the new key shape.
- Note for follow-up (not in scope unless desired): the `DhanStreamData` "Filter Security IDs" field placeholder (`1333, 11536`) now mismatches symbol-based routing keys; it should filter by symbol instead.

## Outcome
- One canonical key `hdfcbank@nse_eq@full` for gateway subscription, Redis subscription set, and routing — identical across the pipeline, exactly like the other brokers.
- `securityId` lives only in the in-memory map (seeded from `HDFCBANK:1333`), used to build Dhan's binary subscribe payload and to enrich incoming ticks, with zero per-tick DB lookups.
- No Dhan-specific stream-naming, routing-name, or routing-from-event functions, and no `buildMarketStreamNamesForControlMessage` wrapper remain; everything rides the generic `buildStreamName`/`buildStreamNames` path with an `exchange` argument.