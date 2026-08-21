/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * InMemoryStore - Execution-scoped RAM storage
 * 
 * Purpose:
 * - Lives for ONE workflow run only
 * - Automatically destroyed after run completes
 * - Shared by all tools in that run
 * 
 * What it stores:
 * - Raw market data (bars, fundamentals)
 * - Cached vendor responses
 * - dataRef pointers
 * - Intermediate indicator results
 * 
 * What it must NOT store:
 * - Final results (use Redis/DB)
 * - Cross-run data (use Redis)
 * - User settings (use DB)
 * - Credentials (use CredentialManager)
 */

export interface DataRef {
  /** Unique reference key (e.g., "bars:AAPL:1D:2019-2024") */
  ref: string;
  /** Data type identifier */
  type: 'bars' | 'quotes' | 'fundamentals' | 'indicators' | 'custom';
  /** Number of rows/items */
  rows: number;
  /** Data source (alpaca, polygon, yahoo, etc.) */
  source: string;
  /** Whether this was retrieved from cache */
  cached: boolean;
  /** Timestamp when data was fetched */
  fetchedAt: string;
  /** Optional metadata */
  meta?: Record<string, any>;
}

export interface InMemoryEntry {
  /** The actual data */
  data: any;
  /** Reference metadata */
  dataRef: DataRef;
  /** When this entry was created */
  createdAt: Date;
  /** Last access time (for potential LRU eviction) */
  lastAccessedAt: Date;
  /** Size estimate in bytes (approximate) */
  sizeBytes: number;
}

export class InMemoryStore {
  private store = new Map<string, InMemoryEntry>();
  private readonly runId: string;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;

  /**
   * Create a new InMemoryStore for a single workflow run
   * @param runId - Unique identifier for this workflow run
   * @param maxSizeMB - Maximum memory allocation in MB (default 256MB)
   */
  constructor(runId: string, maxSizeMB: number = 256) {
    this.runId = runId;
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    console.log(`📦 InMemoryStore created for run ${runId} (max ${maxSizeMB}MB)`);
  }

  /**
   * Generate a dataRef key for market data
   */
  static buildDataRefKey(
    type: DataRef['type'],
    symbol: string,
    timeframe: string,
    startDate: string,
    endDate: string
  ): string {
    return `${type}:${symbol}:${timeframe}:${startDate}-${endDate}`;
  }

  /**
   * Store data and return a dataRef
   * @param key - Unique key for this data
   * @param data - The actual data to store
   * @param metadata - Additional metadata for the dataRef
   * @returns DataRef pointing to the stored data
   */
  set(
    key: string,
    data: any,
    metadata: Partial<Omit<DataRef, 'ref' | 'cached'>>
  ): DataRef {
    const sizeBytes = this.estimateSize(data);
    const existing = this.store.get(key);
    if (existing) {
      this.currentSizeBytes -= existing.sizeBytes;
      this.store.delete(key);
    }
    
    // Check if we need to evict old entries
    while (this.currentSizeBytes + sizeBytes > this.maxSizeBytes && this.store.size > 0) {
      this.evictOldest();
    }

    const now = new Date();
    const rows = Array.isArray(data) ? data.length : 1;

    const dataRef: DataRef = {
      ref: key,
      type: metadata.type || 'custom',
      rows,
      source: metadata.source || 'unknown',
      cached: false,
      fetchedAt: now.toISOString(),
      meta: metadata.meta,
    };

    const entry: InMemoryEntry = {
      data,
      dataRef,
      createdAt: now,
      lastAccessedAt: now,
      sizeBytes,
    };

    this.store.set(key, entry);
    this.currentSizeBytes += sizeBytes;

    console.log(`📥 InMemoryStore[${this.runId}]: Stored ${key} (${rows} rows, ${this.formatBytes(sizeBytes)})`);

    return dataRef;
  }

  /**
   * Get data by dataRef key
   * @param key - The dataRef key
   * @returns The stored data or undefined if not found
   */
  get(key: string): any | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    // Update last accessed time
    entry.lastAccessedAt = new Date();
    return entry.data;
  }

  /**
   * Get data by DataRef object
   * @param dataRef - The DataRef object
   * @returns The stored data or undefined if not found
   */
  getByRef(dataRef: DataRef): any | undefined {
    return this.get(dataRef.ref);
  }

  /**
   * Check if data exists for a key
   * @param key - The dataRef key
   * @returns True if data exists
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Get the DataRef for a key (without the actual data)
   * @param key - The dataRef key
   * @returns The DataRef or undefined
   */
  getDataRef(key: string): DataRef | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    // Mark as cached for subsequent access
    return { ...entry.dataRef, cached: true };
  }

  /**
   * Get or fetch data - if exists, return cached dataRef; if not, call fetcher
   * @param key - The dataRef key
   * @param fetcher - Function to fetch data if not in cache
   * @param metadata - Metadata for the dataRef
   * @returns DataRef pointing to the data
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<any>,
    metadata: Partial<Omit<DataRef, 'ref' | 'cached'>>
  ): Promise<DataRef> {
    const existing = this.getDataRef(key);
    if (existing) {
      console.log(`📦 InMemoryStore[${this.runId}]: Cache hit for ${key}`);
      return existing;
    }

    console.log(`📦 InMemoryStore[${this.runId}]: Cache miss for ${key}, fetching...`);
    const data = await fetcher();
    return this.set(key, data, metadata);
  }

  /**
   * Remove data by key
   * @param key - The dataRef key
   */
  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    this.currentSizeBytes -= entry.sizeBytes;
    this.store.delete(key);
    console.log(`🗑️ InMemoryStore[${this.runId}]: Deleted ${key}`);
    return true;
  }

  /**
   * Clear all data - called when workflow run completes
   */
  clear(): void {
    const count = this.store.size;
    const size = this.currentSizeBytes;
    this.store.clear();
    this.currentSizeBytes = 0;
    console.log(`🧹 InMemoryStore[${this.runId}]: Cleared ${count} entries (${this.formatBytes(size)})`);
  }

  /**
   * Get statistics about current memory usage
   */
  getStats(): {
    runId: string;
    entryCount: number;
    totalSizeBytes: number;
    maxSizeBytes: number;
    utilizationPercent: number;
  } {
    return {
      runId: this.runId,
      entryCount: this.store.size,
      totalSizeBytes: this.currentSizeBytes,
      maxSizeBytes: this.maxSizeBytes,
      utilizationPercent: (this.currentSizeBytes / this.maxSizeBytes) * 100,
    };
  }

  /**
   * List all stored dataRefs
   */
  listDataRefs(): DataRef[] {
    return Array.from(this.store.values()).map(entry => ({
      ...entry.dataRef,
      cached: true,
    }));
  }

  // Private helpers

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = new Date();

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.store.get(oldestKey)!;
      this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(oldestKey);
      console.log(`⚠️ InMemoryStore[${this.runId}]: Evicted ${oldestKey} (LRU)`);
    }
  }

  private estimateSize(data: any): number {
    if (data === null || data === undefined) return 8;
    if (typeof data === 'boolean') return 4;
    if (typeof data === 'number') return 8;
    if (typeof data === 'string') return data.length * 2;
    if (Array.isArray(data)) {
      return data.reduce((acc, item) => acc + this.estimateSize(item), 8);
    }
    if (typeof data === 'object') {
      return Object.entries(data).reduce(
        (acc, [key, value]) => acc + key.length * 2 + this.estimateSize(value),
        8
      );
    }
    return 8;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
