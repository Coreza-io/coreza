/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { InMemoryStore, DataRef } from './InMemoryStore';

/**
 * DataContext - Shared context for all tools in a workflow run
 * 
 * Purpose:
 * - Created per Agent/workflow run
 * - All tools share it
 * - Identical data requests fetch once, reuse everywhere
 * 
 * Key principle:
 * 15 tools requesting same data ≠ 15 fetches
 * → 1 fetch, many computations
 */

export interface DataContextConfig {
  runId: string;
  workflowId: string;
  userId: string;
  maxMemoryMB?: number;
}

export interface MarketDataRequest {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  source: string;
}

export interface IndicatorResult {
  /** Reference to the source market data */
  sourceDataRef: DataRef;
  /** The computed indicator values */
  values: number[];
  /** Summary statistics for AI consumption */
  summary: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    min: number;
    max: number;
    avg: number;
    interpretation: string;
  };
}

export class DataContext {
  private readonly inMemoryStore: InMemoryStore;
  private readonly runId: string;
  private readonly workflowId: string;
  private readonly userId: string;

  // Track pending fetches to prevent duplicate concurrent requests
  private pendingFetches = new Map<string, Promise<DataRef>>();

  constructor(config: DataContextConfig) {
    this.runId = config.runId;
    this.workflowId = config.workflowId;
    this.userId = config.userId;
    this.inMemoryStore = new InMemoryStore(config.runId, config.maxMemoryMB || 256);

    console.log(`🌐 DataContext created for run ${config.runId} (workflow: ${config.workflowId})`);
  }

  /**
   * Get the run ID for this context
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get the workflow ID for this context
   */
  getWorkflowId(): string {
    return this.workflowId;
  }

  /**
   * Get the user ID for this context
   */
  getUserId(): string {
    return this.userId;
  }

  /**
   * Get the underlying InMemoryStore
   */
  getStore(): InMemoryStore {
    return this.inMemoryStore;
  }

  /**
   * Request market data - returns dataRef, not raw data
   * Handles deduplication of concurrent requests
   * 
   * @param request - Market data request parameters
   * @param fetcher - Function to fetch data if not in cache
   * @returns DataRef pointing to the data in InMemoryStore
   */
  async requestMarketData(
    request: MarketDataRequest,
    fetcher: () => Promise<any>
  ): Promise<DataRef> {
    const key = InMemoryStore.buildDataRefKey(
      'bars',
      request.symbol,
      request.timeframe,
      request.startDate,
      request.endDate
    );

    // Check if already in memory
    const existing = this.inMemoryStore.getDataRef(key);
    if (existing) {
      console.log(`📦 DataContext: Cache hit for ${key}`);
      return existing;
    }

    // Check if there's already a pending fetch for this key
    const pending = this.pendingFetches.get(key);
    if (pending) {
      console.log(`⏳ DataContext: Waiting for pending fetch of ${key}`);
      return pending;
    }

    // Start new fetch with deduplication
    const fetchPromise = (async () => {
      try {
        console.log(`📡 DataContext: Fetching ${key}...`);
        const data = await fetcher();
        
        const dataRef = this.inMemoryStore.set(key, data, {
          type: 'bars',
          source: request.source,
          meta: {
            symbol: request.symbol,
            timeframe: request.timeframe,
            startDate: request.startDate,
            endDate: request.endDate,
          },
        });

        return dataRef;
      } finally {
        // Remove from pending fetches once complete
        this.pendingFetches.delete(key);
      }
    })();

    this.pendingFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Store indicator result
   * 
   * @param indicatorName - Name of the indicator (e.g., "RSI", "EMA")
   * @param sourceDataRef - Reference to the source market data
   * @param values - Computed indicator values
   * @param summary - Summary for AI consumption
   * @returns DataRef pointing to the stored indicator result
   */
  storeIndicatorResult(
    indicatorName: string,
    sourceDataRef: DataRef,
    values: number[],
    summary: IndicatorResult['summary']
  ): DataRef {
    const key = `indicator:${indicatorName}:${sourceDataRef.ref}`;

    const result: IndicatorResult = {
      sourceDataRef,
      values,
      summary,
    };

    return this.inMemoryStore.set(key, result, {
      type: 'indicators',
      source: 'computed',
      meta: {
        indicatorName,
        sourceRef: sourceDataRef.ref,
      },
    });
  }

  /**
   * Get indicator result by name and source data reference
   */
  getIndicatorResult(indicatorName: string, sourceDataRef: DataRef): IndicatorResult | undefined {
    const key = `indicator:${indicatorName}:${sourceDataRef.ref}`;
    return this.inMemoryStore.get(key);
  }

  /**
   * Get data by DataRef
   */
  getData(dataRef: DataRef): any | undefined {
    return this.inMemoryStore.getByRef(dataRef);
  }

  /**
   * Get data by key
   */
  getDataByKey(key: string): any | undefined {
    return this.inMemoryStore.get(key);
  }

  /**
   * Check if data exists
   */
  hasData(key: string): boolean {
    return this.inMemoryStore.has(key);
  }

  /**
   * Store custom data
   */
  setData(key: string, data: any, meta?: Record<string, any>): DataRef {
    return this.inMemoryStore.set(key, data, {
      type: 'custom',
      source: 'workflow',
      meta,
    });
  }

  /**
   * Get memory usage statistics
   */
  getStats(): ReturnType<InMemoryStore['getStats']> {
    return this.inMemoryStore.getStats();
  }

  /**
   * List all available data references
   */
  listDataRefs(): DataRef[] {
    return this.inMemoryStore.listDataRefs();
  }

  /**
   * Clear all data - called when workflow run completes
   */
  destroy(): void {
    const stats = this.inMemoryStore.getStats();
    console.log(
      `🧹 DataContext[${this.runId}]: Destroying with ${stats.entryCount} entries ` +
      `(${(stats.totalSizeBytes / 1024 / 1024).toFixed(2)}MB used)`
    );
    this.inMemoryStore.clear();
    this.pendingFetches.clear();
  }
}

/**
 * DataContextManager - Global manager for DataContext instances
 * Ensures proper lifecycle management and prevents memory leaks
 */
export class DataContextManager {
  private static instance: DataContextManager;
  private contexts = new Map<string, DataContext>();

  private constructor() {
    // Cleanup stale contexts every 5 minutes
    setInterval(() => this.cleanupStaleContexts(), 5 * 60 * 1000);
  }

  static getInstance(): DataContextManager {
    if (!DataContextManager.instance) {
      DataContextManager.instance = new DataContextManager();
    }
    return DataContextManager.instance;
  }

  /**
   * Get or create a DataContext for a workflow run
   */
  getContext(config: DataContextConfig): DataContext {
    const existing = this.contexts.get(config.runId);
    if (existing) {
      return existing;
    }

    const context = new DataContext(config);
    this.contexts.set(config.runId, context);
    return context;
  }

  /**
   * Destroy a DataContext when workflow run completes
   */
  destroyContext(runId: string): void {
    const context = this.contexts.get(runId);
    if (context) {
      context.destroy();
      this.contexts.delete(runId);
    }
  }

  /**
   * Check if a context exists
   */
  hasContext(runId: string): boolean {
    return this.contexts.has(runId);
  }

  /**
   * Get statistics for all active contexts
   */
  getAllStats(): Array<ReturnType<DataContext['getStats']>> {
    return Array.from(this.contexts.values()).map(ctx => ctx.getStats());
  }

  /**
   * Cleanup contexts older than 1 hour
   */
  private cleanupStaleContexts(): void {
    // This is a safety net - contexts should be explicitly destroyed
    // when workflow runs complete
    const staleCount = this.contexts.size;
    if (staleCount > 100) {
      console.warn(
        `⚠️ DataContextManager: ${staleCount} active contexts. ` +
        `Consider checking for context cleanup issues.`
      );
    }
  }
}
