
# Broker Abstraction: Zero Hardcoded Broker Logic

## Goal
Every broker-specific reference outside of `coreza-backend/src/brokers/{broker}/` config files and `src/nodes/*.json` must be eliminated. Adding a new broker = new node JSONs + new broker config folder. Zero code changes elsewhere.

---

## Current Violations Inventory

### FRONTEND (src/)

| File | Violation | Severity |
|------|-----------|----------|
| `src/utils/streamNameParser.ts` | Hardcoded `if (source.startsWith("binance"))` and `if (source === "alpaca")` parse branches | High |
| `src/utils/alpacaNews.ts` | Entire file is Alpaca-specific (`AlpacaNewsPayload`, `AlpacaNewsOutput`) | High |
| `src/hooks/useNodeOutput.ts` | `if (definition?.name === "AlpacaNews")` special-case logic | High |
| `src/pages/WorkflowEditor.tsx` | Hardcoded `cleanupAlpacaSubscription`, `AlpacaNews` name checks, `alpaca-news/unsubscribe` endpoint | High |
| `src/pages/MarketSubscriptions.tsx` | Hardcoded `["alpaca", "binance", "dhan", "schwab"]` array, broker-specific colors/emojis | High |
| `src/utils/reconcileNodeValues.ts` | `migrateAlpacaStreamDataValues()` function checking `definition?.name === "AlpacaStreamData"` | Medium |
| `src/components/auth/SchwabAuthModal.tsx` | Schwab-specific OAuth modal (hardcoded endpoints, URLs) | Medium |
| `src/components/nodes/layout/components/LayoutAuthModal.tsx` | `if (definition.auth === "SchwabAuthModal")` conditional rendering | Medium |

### BACKEND (coreza-backend/src/) — Outside broker config folders

| File | Violation | Severity |
|------|-----------|----------|
| `nodes/executors/BrokerExecutor.ts` | `if (broker === "alpaca" && assetType === "crypto")`, hardcoded `extractAlpacaOrderOwnerIds`/`extractBinanceOrderOwnerIds` imports and switch | Critical |
| `nodes/executors/PortfolioExecutor.ts` | Alpaca-specific types (`AlpacaAccountResponse`, `AlpacaPosition`, `AlpacaOrder`), `normalizeAlpacaCryptoSymbol`, `sync_from_broker supports alpaca only`, `get_open_algo_orders supports binance only`, hardcoded broker defaults `|| "binance"` | Critical |
| `nodes/executors/MarketExecutor.ts` | Hardcoded `AlpacaSubscribe`, `BinanceSubscribe` name checks in comments/routing | Medium |
| `nodes/executors/ToolExecutor.ts` | Hardcoded maps `{ Alpaca: "Market", Binance: "Market", ... }`, `{ AlpacaTrade: "Broker", ... }` | High |
| `nodes/executors/AIAgentExecutor.ts` | Hardcoded `{ Alpaca: "Broker", ... }`, `{ AlpacaScreener: "Screener", ... }` maps, `nodeName.includes("Alpaca")` | High |
| `nodes/logic/toolDefinitions.ts` | Hardcoded `{ Alpaca: { description: "..." }, Binance: ... }` per-broker descriptions | High |
| `nodes/logic/toolOutputProcessor.ts` | Hardcoded lists of broker node names in multiple arrays | High |
| `utils/streamName.ts` | Hardcoded `if (source === "alpaca_trading")`, `if (source.startsWith("binance"))` branches in parsing and stream-name building | Critical |
| `utils/credentialValidator.ts` | `switch (serviceType)` with per-broker validation methods | High |
| `routes/helpers/streamSource.ts` | `if (source === "alpaca" && normalizedAsset === "crypto")` hardcoded asset routing | High |
| `workflow/subscriptionPolicy.ts` | Hardcoded `nodeNameToSourceMap` with `BinanceStreamData`, `AlpacaStreamData`, etc. | High |
| `workflow/triggerClassifier.ts` | `STREAMING_NODE_NAMES` hardcoded Set of broker node names | High |
| `workflow/StreamingLifecycleAdapter.ts` | Hardcoded trading stream arrays for `alpaca_trading`, `binance_trading`, `isTradingSource()` | Critical |
| `config/oauth.ts` | Already config-driven (good), but `SCHWAB_REDIRECT_URI` constant is acceptable in config |  OK |
| `services/SubscriptionManager.ts` | `source: 'alpaca'` default hardcoded | Medium |
| `infra/websocketManager.ts` | `case "alpaca_news"` hardcoded routing | Medium |
| `backtest/simBroker/FeeModel.ts` | Alpaca comments only | Low |
| `utils/binanceTimeSync.ts` | Binance-specific utility (should live under `brokers/binance/`) | Medium |
| `utils/dhanBinaryParser.ts` | Dhan-specific utility (should live under `brokers/dhan/`) | Medium |
| `utils/schwabStreamingSetup.ts` | Schwab-specific utility (should live under `brokers/schwab/`) | Medium |

---

## Implementation Plan

### Phase 1: Config Registry Foundation (Backend)

**1.1 Create `BrokerCapabilities` config interface**

Add to `coreza-backend/src/brokers/types.ts`:

```text
BrokerCapabilities {
  id: string                          // "alpaca", "binance"
  displayName: string                 // "Alpaca", "Binance" 
  nodeNames: {
    data: string                      // "Alpaca" (market data node)
    trade: string                     // "AlpacaTrade"
    screener?: string                 // "AlpacaScreener"
    subscribe?: string                // "AlpacaSubscribe"
    streamData?: string               // "AlpacaStreamData"
  }
  category: "Market" | "Broker" | "Screener"
  streaming: {
    sourceId: string                  // "alpaca_stream"
    tradingSourceId?: string          // "alpaca_trading"
    tradingStreams?: string[]          // ["trade_updates"]
    newsSourceId?: string             // "alpaca_news"
  }
  symbolFormat: {
    normalize?: (symbol, assetType?) => string
    parseTradingStreamName?: (stream) => string  // trading stream → symbol
    parseMarketStreamName?: (stream) => ParsedStream
  }
  credentialValidation?: {
    requiredFields: { key: string; label: string; minLength?: number }[]
  }
  orderOwnerExtract?: (data: any) => string
  assetTypes?: string[]               // ["stock", "crypto"]
}
```

**1.2 Create broker capability configs**

In each `coreza-backend/src/brokers/{broker}/capabilities.ts`, export the capability config. Move `binanceTimeSync.ts`, `dhanBinaryParser.ts`, `schwabStreamingSetup.ts` into their respective broker folders.

**1.3 Create `BROKER_CAPABILITIES` registry**

In `coreza-backend/src/brokers/index.ts`, aggregate all capabilities into a single lookup map, plus helper functions:
- `getBrokerByNodeName(nodeName)` — reverse-lookup broker from any node name
- `getStreamingBrokers()` — all brokers with streaming config
- `getTradingStreams(source)` — get trading stream names from source
- `getOrderOwnerExtractor(broker)` — get extractor function
- `getCredentialValidator(serviceType)` — get validation rules

### Phase 2: Backend Elimination of Hardcoded Logic

**2.1 `BrokerExecutor.ts`** — Replace `if (broker === "alpaca")` with `BROKER_CAPABILITIES[broker].symbolFormat.normalize?.()`. Replace hardcoded `extractAlpacaOrderOwnerIds`/`extractBinanceOrderOwnerIds` with `BROKER_CAPABILITIES[broker].orderOwnerExtract?.(data)`.

**2.2 `PortfolioExecutor.ts`** — Replace Alpaca-specific types with generic broker response types. Replace `normalizeAlpacaCryptoSymbol` with `BROKER_CAPABILITIES[broker].symbolFormat.normalize()`. Replace `"sync_from_broker supports alpaca only"` guards with capability checks. Replace `|| "binance"` defaults with explicit broker param requirements.

**2.3 `StreamingLifecycleAdapter.ts`** — Replace hardcoded `getTradingStreams()` with `BROKER_CAPABILITIES[broker].streaming.tradingStreams`. Replace `isTradingSource()` with `Object.values(BROKER_CAPABILITIES).some(b => b.streaming.tradingSourceId === source)`.

**2.4 `utils/streamName.ts`** — Replace broker-specific `if` branches with a loop over `BROKER_CAPABILITIES` entries, using each broker's `symbolFormat.parseMarketStreamName()` and `symbolFormat.parseTradingStreamName()`.

**2.5 `workflow/subscriptionPolicy.ts`** — Auto-generate `nodeNameToSourceMap` from `BROKER_CAPABILITIES` entries: `Object.fromEntries(Object.values(BROKER_CAPABILITIES).filter(b => b.nodeNames.streamData).map(b => [b.nodeNames.streamData, b.streaming.sourceId]))`.

**2.6 `workflow/triggerClassifier.ts`** — Auto-generate `STREAMING_NODE_NAMES` from capabilities: `new Set(Object.values(BROKER_CAPABILITIES).flatMap(b => [b.nodeNames.streamData, b.nodeNames.news].filter(Boolean)))`.

**2.7 `nodes/executors/ToolExecutor.ts` & `AIAgentExecutor.ts`** — Auto-generate category maps from `BROKER_CAPABILITIES` instead of hardcoded `{ Alpaca: "Market", ... }`.

**2.8 `nodes/logic/toolDefinitions.ts`** — Move descriptions into node JSON `description` field or into `BrokerCapabilities.displayName`. Auto-generate from registry.

**2.9 `nodes/logic/toolOutputProcessor.ts`** — Replace hardcoded node name arrays with lookups from capabilities registry.

**2.10 `utils/credentialValidator.ts`** — Replace `switch (serviceType)` with `BROKER_CAPABILITIES[serviceType]?.credentialValidation`. Each broker's validation rules come from its capability config.

**2.11 `routes/helpers/streamSource.ts`** — Replace Alpaca-specific asset routing with generic logic: check `BROKER_CAPABILITIES[source].assetTypes` to build source IDs.

**2.12 `infra/websocketManager.ts`** — Replace `case "alpaca_news"` with generic routing via capabilities.

**2.13 `services/SubscriptionManager.ts`** — Remove hardcoded `source: 'alpaca'` default; require explicit source.

**2.14 Move broker-specific utilities** — `utils/binanceTimeSync.ts` → `brokers/binance/timeSync.ts`, `utils/dhanBinaryParser.ts` → `brokers/dhan/binaryParser.ts`, `utils/schwabStreamingSetup.ts` → `brokers/schwab/streamingSetup.ts`.

### Phase 3: Frontend Elimination of Hardcoded Logic

**3.1 `src/utils/streamNameParser.ts`** — Create a config-driven parser registry. Each broker registers its parse pattern (e.g., Binance uses `@` separator, Alpaca uses `.` separator). The parser iterates the registry instead of `if/else`.

**3.2 `src/utils/alpacaNews.ts` + `src/hooks/useNodeOutput.ts`** — Generalize to a "News output" utility, not Alpaca-specific. The node JSON's `subCategory` or `outputFormat` field should drive output handling, not the node name.

**3.3 `src/pages/WorkflowEditor.tsx`** — Replace `cleanupAlpacaSubscription` with a generic `cleanupStreamSubscription` that reads source from the node definition. Replace `AlpacaNews` name checks with `definition.subCategory === "news"` or similar JSON-driven check.

**3.4 `src/pages/MarketSubscriptions.tsx`** — Replace hardcoded broker array with dynamic list derived from available node JSONs (all nodes with `subCategory === "broker"` or `category === "Market"`). Replace hardcoded color/emoji maps with values from node JSON (add `badgeColor` and `icon` to node definition).

**3.5 `src/utils/reconcileNodeValues.ts`** — Replace `migrateAlpacaStreamDataValues()` with a generic migration function driven by node JSON migration rules or remove if no longer needed.

**3.6 `src/components/auth/SchwabAuthModal.tsx` + `LayoutAuthModal.tsx`** — The `auth` field in node JSON already drives which modal to show. Keep `SchwabAuthModal` as a component but ensure `LayoutAuthModal` uses a registry pattern: `AUTH_MODALS[definition.auth]` instead of `if/else`.

### Phase 4: Node JSON Enrichment

Add fields to node JSONs so the frontend/backend can derive everything from config:

```text
{
  "name": "Alpaca",
  "broker": "alpaca",              // links to BROKER_CAPABILITIES
  "subCategory": "broker",
  "streamFormat": "dot",           // "dot" = bars.AAPL, "at" = btcusdt@kline_1m
  "badgeColor": "emerald",         // for MarketSubscriptions UI
  "badgeEmoji": "🦙",
  "description": "Request historical or real-time market data from Alpaca."
}
```

### Phase 5: Verification

- Grep for all broker names in files outside `brokers/*/` and `nodes/*.json` — should return zero matches
- Run existing test suites to verify no regressions
- Test adding a hypothetical new broker by only creating JSON + config

---

## Files Changed Summary

### Backend (~25 files)
- **New**: `brokers/{alpaca,binance,dhan,schwab}/capabilities.ts` (4 files)
- **Modified**: `BrokerExecutor.ts`, `PortfolioExecutor.ts`, `MarketExecutor.ts`, `ToolExecutor.ts`, `AIAgentExecutor.ts`, `toolDefinitions.ts`, `toolOutputProcessor.ts`, `streamName.ts`, `credentialValidator.ts`, `streamSource.ts`, `subscriptionPolicy.ts`, `triggerClassifier.ts`, `StreamingLifecycleAdapter.ts`, `websocketManager.ts`, `SubscriptionManager.ts`, `brokers/index.ts`, `brokers/types.ts`
- **Moved**: `binanceTimeSync.ts`, `dhanBinaryParser.ts`, `schwabStreamingSetup.ts` into broker folders

### Frontend (~8 files)
- **Modified**: `streamNameParser.ts`, `alpacaNews.ts` (renamed to generic), `useNodeOutput.ts`, `WorkflowEditor.tsx`, `MarketSubscriptions.tsx`, `reconcileNodeValues.ts`, `LayoutAuthModal.tsx`
- **Modified**: Several node JSON files (add `broker`, `streamFormat`, `badgeColor` fields)

### Estimated Effort
This is a significant refactor touching ~30+ files across both repos. Recommend implementing in phases, with Phase 1-2 (backend) first, then Phase 3-4 (frontend), with tests after each phase.
