

## Plan: Refactor to Use Stream Names as Primary Tracking Unit

### Current State Analysis

Currently, we track subscriptions at **three levels** with redundant data:

1. **MarketControlHandler (SourceState)**:
   - `symbols: Set<string>` - Just symbol names (BTCUSDT)
   - `symbolTypes: Map<string, Set<string>>` - Symbol → event types mapping
   - `workflowSymbols: Map<string, Set<string>>` - Workflow → symbols mapping

2. **MarketDataGateway**:
   - `subscribedSymbolTypes: Map<string, Set<string>>` - Symbol → event types mapping

3. **Redis Storage**:
   - `:streams` keys with native stream names (btcusdt@kline_1m)

This creates **duplication and conversion overhead**:
- When subscribing: symbols + eventTypes → build stream names → store
- When checking duplicates: loop through symbols, check each type
- When restoring: parse stored data, rebuild relationships

---

### Proposed Solution: Stream Names as Single Source of Truth

Replace `symbols` + `symbolTypes` tracking with a single `streams: Set<string>` containing native stream names.

```text
BEFORE:
  symbols: Set { "BTCUSDT", "ETHUSDT" }
  symbolTypes: Map { "BTCUSDT" → Set { "kline_1m", "trade" }, ... }
  
AFTER:
  streams: Set { "btcusdt@kline_1m", "btcusdt@trade", "ethusdt@kline_1m", ... }
```

---

### Phase 1: Update SourceState Interface

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

```typescript
interface SourceState {
  source: MarketSource;
  gateway: MarketDataGateway;
  connectedUserId: string;
  credentialId: string;
  // REPLACE these two:
  // symbols: Set<string>;
  // symbolTypes: Map<string, Set<string>>;
  
  // WITH this single set:
  streams: Set<string>;  // Native stream names (btcusdt@kline_1m)
  
  workflowSymbols: Map<string, Set<string>>; // Keep for workflow cleanup reference
}
```

---

### Phase 2: Update handleSubscribe Logic

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

```typescript
private async handleSubscribe(msg: ControlMessage): Promise<void> {
  // ... existing gateway connection logic ...

  // Build stream names FIRST (before any tracking)
  const { interval, depthLevels, scope, targetWorkflowId } = msg;
  const processedEventTypes = this.processEventTypesForStreamNames(
    eventTypes || [],
    source,
    interval,
    depthLevels,
  );
  
  const requestedStreamNames = buildStreamNames(
    source,
    symbols,
    processedEventTypes,
  );

  // Check which stream names are NEW (not already in state.streams)
  const newStreamNames = requestedStreamNames.filter(
    (name) => !state.streams.has(name)
  );

  if (newStreamNames.length > 0) {
    console.log(
      `➕ [MarketControl] Subscribing to new streams on ${source}:`,
      newStreamNames.slice(0, 5).join(", ") + (newStreamNames.length > 5 ? "..." : ""),
    );

    // Add to tracking
    newStreamNames.forEach((name) => state.streams.add(name));

    // Subscribe gateway with stream names directly
    state.gateway.subscribeStreams(newStreamNames);

    // Persist to Redis
    await this.persistState(userId, source);

    // Store stream names in Redis (:streams key)
    const streamsKey = scope === "workflow" && targetWorkflowId
      ? REDIS_CHANNELS.workflowSubscriptionStreams(userId, targetWorkflowId, source)
      : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

    await this.redisPub.sadd(streamsKey, ...newStreamNames);

    // Extract symbols from new stream names for workflow notification
    const newSymbols = [...new Set(
      newStreamNames.map((name) => extractSymbol(source, name))
    )];
    
    await this.updateActiveStreamingWorkflows(userId, newSymbols, scope, targetWorkflowId);
  }
}
```

---

### Phase 3: Update handleUnsubscribe Logic

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

```typescript
private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
  // ... existing state lookup ...

  if (symbols.length > 0) {
    // Build stream names to remove
    const processedEventTypes = this.processEventTypesForStreamNames(
      eventTypes || [],
      source,
      interval,
      depthLevels,
    );
    
    const streamNamesToRemove = buildStreamNames(source, symbols, processedEventTypes);

    console.log(
      `➖ [MarketControl] Unsubscribing from streams on ${source}:`,
      streamNamesToRemove,
    );

    // Remove from tracking
    streamNamesToRemove.forEach((name) => state.streams.delete(name));

    // Unsubscribe gateway with stream names directly
    state.gateway.unsubscribeStreams(streamNamesToRemove);

    // Remove from Redis
    const streamsKey = scope === "workflow" && targetWorkflowId
      ? REDIS_CHANNELS.workflowSubscriptionStreams(userId, targetWorkflowId, source)
      : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

    await this.redisPub.srem(streamsKey, ...streamNamesToRemove);

    await this.persistState(userId, source);
  }

  // Disconnect if no more streams
  if (state.streams.size === 0) {
    state.gateway.disconnect();
    this.sourceStates.delete(stateKey);
    await this.redisPub.del(REDIS_CHANNELS.gatewayState(userId, source));
  }
}
```

---

### Phase 4: Update MarketDataGateway

**File:** `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts`

Replace `subscribedSymbolTypes` with `subscribedStreams`:

```typescript
export class MarketDataGateway {
  // REPLACE:
  // private subscribedSymbolTypes = new Map<string, Set<string>>();
  
  // WITH:
  private subscribedStreams = new Set<string>();  // Native stream names

  /**
   * Subscribe to streams using native stream names directly
   */
  subscribeStreams(streamNames: string[]): void {
    const newStreams = streamNames.filter((name) => !this.subscribedStreams.has(name));
    
    if (newStreams.length === 0) {
      this.logger.debug({ source: this.source }, "All streams already subscribed");
      return;
    }

    // Add to tracking
    newStreams.forEach((name) => this.subscribedStreams.add(name));

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      // Pass stream names directly to broker-specific subscribe message builder
      const msg = this.config.makeSubscribeMessageFromStreams?.(newStreams) 
        || this.config.makeSubscribeMessage(
            this.extractSymbolsFromStreams(newStreams),
            this.extractTypesFromStreams(newStreams),
            undefined,
            this.source
          );
      this.ws.send(this.encodeMessage(msg));
      this.logger.info({ source: this.source, streams: newStreams }, "Subscribed to streams");
    }
  }

  unsubscribeStreams(streamNames: string[]): void {
    const existingStreams = streamNames.filter((name) => this.subscribedStreams.has(name));
    
    if (existingStreams.length === 0) return;

    existingStreams.forEach((name) => this.subscribedStreams.delete(name));

    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.config.makeUnsubscribeMessageFromStreams?.(existingStreams)
        || this.config.makeUnsubscribeMessage(
            this.extractSymbolsFromStreams(existingStreams),
            this.extractTypesFromStreams(existingStreams),
            undefined,
            this.source
          );
      this.ws.send(this.encodeMessage(msg));
    }
  }

  private resubscribeAll(): void {
    if (this.subscribedStreams.size > 0) {
      const streams = Array.from(this.subscribedStreams);
      // Group by symbol/type pattern for efficient subscription
      const msg = this.config.makeSubscribeMessageFromStreams?.(streams)
        || this.config.makeSubscribeMessage(
            this.extractSymbolsFromStreams(streams),
            this.extractTypesFromStreams(streams),
            undefined,
            this.source
          );
      this.ws?.send(this.encodeMessage(msg));
    }
  }

  // Helper to extract symbols from stream names for backward compatibility
  private extractSymbolsFromStreams(streams: string[]): string[] {
    return [...new Set(streams.map((s) => extractSymbol(this.source, s)))];
  }

  // Helper to extract types from stream names
  private extractTypesFromStreams(streams: string[]): string[] {
    return [...new Set(streams.map((s) => parseStreamName(this.source, s).eventType))];
  }

  getStats() {
    return {
      source: this.source,
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      subscribedStreams: Array.from(this.subscribedStreams),  // Changed from symbolTypes
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
```

---

### Phase 5: Update persistState and restoreFromRedis

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

```typescript
private async persistState(userId: string, source: MarketSource): Promise<void> {
  const state = this.sourceStates.get(this.getStateKey(userId, source));
  if (!state) return;

  const stateData = {
    userId: state.connectedUserId,
    credentialId: state.credentialId,
    streams: Array.from(state.streams),  // Native stream names
    workflowSymbols: Array.from(state.workflowSymbols.entries()).map(
      ([wfId, symbols]) => ({
        workflowId: wfId,
        symbols: Array.from(symbols),
      }),
    ),
    timestamp: new Date().toISOString(),
  };

  await redisSetBreaker.fire(
    REDIS_CHANNELS.gatewayState(userId, source),
    JSON.stringify(stateData),
  );
}

private async restoreFromRedis(): Promise<void> {
  // ... existing key scanning ...

  for (const stateKey of stateKeys) {
    // ... parse key and get stateJson ...

    const stateData = JSON.parse(stateJson);
    
    // Reconnect gateway
    await this.connectGateway(source, userId, stateData.credentialId);
    const state = this.sourceStates.get(this.getStateKey(userId, source))!;

    // Restore streams directly - no conversion needed!
    if (stateData.streams && Array.isArray(stateData.streams)) {
      stateData.streams.forEach((s: string) => state.streams.add(s));
      
      // Subscribe gateway with stored stream names
      state.gateway.subscribeStreams(stateData.streams);
      
      console.log(
        `🔄 [MarketControl] Restored ${stateData.streams.length} streams on ${source}`,
      );
    }

    // Backward compatibility: migrate old symbolTypes format
    if (!stateData.streams && stateData.symbolTypes) {
      // Convert old format to stream names
      const migratedStreams = stateData.symbolTypes.flatMap((entry: any) => 
        (entry.types || []).map((type: string) => 
          buildStreamName(source, entry.symbol, type)
        )
      );
      migratedStreams.forEach((s: string) => state.streams.add(s));
      state.gateway.subscribeStreams(migratedStreams);
    }

    // Restore workflow mappings (unchanged)
    // ...
  }
}
```

---

### Phase 6: Update connectGateway

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

```typescript
private async connectGateway(...): Promise<void> {
  // ... existing connection logic ...

  // Track state with streams instead of symbols/symbolTypes
  this.sourceStates.set(this.getStateKey(userId, source), {
    source,
    gateway,
    connectedUserId: userId,
    credentialId: credentialId || "default",
    streams: new Set(),  // Changed from symbols + symbolTypes
    workflowSymbols: new Map(),
  });
}
```

---

### Summary of Changes

| Location | Current | Proposed |
|----------|---------|----------|
| **SourceState** | `symbols: Set`, `symbolTypes: Map` | `streams: Set<string>` |
| **MarketDataGateway** | `subscribedSymbolTypes: Map` | `subscribedStreams: Set<string>` |
| **handleSubscribe** | Build stream names, check symbols/types | Build stream names, check set membership |
| **handleUnsubscribe** | Loop through symbols, delete types | Remove stream names from set |
| **persistState** | Store symbols + symbolTypes separately | Store streams array directly |
| **restoreFromRedis** | Parse symbolTypes, rebuild, subscribe | Read streams, subscribe directly |

---

### Benefits

1. **Single source of truth** - One set of stream names, no conversion needed
2. **Simpler duplicate detection** - `state.streams.has(streamName)` vs looping through symbols/types
3. **Direct gateway passthrough** - Stream names flow from control message → state → gateway → broker
4. **Cleaner restoration** - Stored format = runtime format = broker format
5. **Less code** - Remove symbol/type grouping logic

---

### Technical Consideration: Gateway Compatibility

The gateway's `makeSubscribeMessage` currently expects `(symbols[], types[], options)`. Two options:

**Option A (Recommended)**: Add `makeSubscribeMessageFromStreams(streamNames[])` to gateway configs that parse stream names internally.

**Option B**: Keep backward-compatible helpers in MarketDataGateway that extract symbols/types from stream names for brokers that need them.

I recommend Option A for Binance (stream names are the native format), and Option B as fallback for other brokers.

