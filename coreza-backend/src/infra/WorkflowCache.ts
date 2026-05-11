/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger";
import { workflowCacheSizeGauge } from "../utils/metrics";

const logger = createLogger("WorkflowCache");

interface CachedWorkflow {
  workflow: any;
  expiresAt: number;
}

/**
 * WorkflowCache - Production-ready workflow definition cache
 *
 * Caches workflow definitions in memory to avoid repeated Supabase queries
 * during high-frequency market data events. Implements TTL-based expiration.
 */
export class WorkflowCache {
  private static instance: WorkflowCache;
  private cache = new Map<string, CachedWorkflow>();
  private supabase: SupabaseClient;
  private readonly DEFAULT_TTL_MS = 60000; // 60 seconds
  private readonly MAX_CACHE_SIZE = 1000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || "",
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) || "",
    );
  }

  static getInstance(): WorkflowCache {
    if (!WorkflowCache.instance) {
      WorkflowCache.instance = new WorkflowCache();
    }
    return WorkflowCache.instance;
  }

  /**
   * Get workflow definition with caching
   * @param workflowId - Workflow UUID
   * @param ttlMs - Cache TTL in milliseconds (default: 60s)
   * @returns Workflow definition or null if not found
   */
  async getWorkflow(
    workflowId: string,
    ttlMs: number = this.DEFAULT_TTL_MS,
  ): Promise<any | null> {
    // Check cache first
    const cached = this.cache.get(workflowId);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ workflowId, cacheSize: this.cache.size }, "Cache HIT");
      return cached.workflow;
    }

    // Cache miss - fetch from Supabase
    logger.debug({ workflowId }, "Cache MISS - fetching from database");

    try {
      const { data: workflow, error } = await this.supabase
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        //.eq('is_active', true)
        .single();

      if (error) {
        logger.error({ workflowId, error }, "Failed to fetch workflow");
        return null;
      }

      if (!workflow) {
        logger.warn({ workflowId }, "Workflow not found or inactive");
        return null;
      }

      // Cache the result
      this.cache.set(workflowId, {
        workflow,
        expiresAt: Date.now() + ttlMs,
      });

      workflowCacheSizeGauge.set(this.cache.size);
      logger.info(
        { workflowId, ttlMs, cacheSize: this.cache.size },
        "Workflow cached",
      );
      return workflow;
    } catch (error) {
      logger.error({ workflowId, error }, "Error fetching workflow");
      return null;
    }
  }

  /**
   * Invalidate specific workflow from cache
   */
  invalidate(workflowId: string): void {
    this.cache.delete(workflowId);
    workflowCacheSizeGauge.set(this.cache.size);
    logger.info(
      { workflowId, cacheSize: this.cache.size },
      "Workflow invalidated",
    );
  }

  /**
   * Invalidate all cached workflows
   */
  invalidateAll(): void {
    this.cache.clear();
    workflowCacheSizeGauge.set(0);
    logger.info("Cleared all cached workflows");
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    entries: Array<{ workflowId: string; expiresIn: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(
      ([workflowId, cached]) => ({
        workflowId,
        expiresIn: Math.max(0, cached.expiresAt - now),
      }),
    );

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Clean up expired entries (run periodically)
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [workflowId, cached] of this.cache.entries()) {
      if (cached.expiresAt <= now) {
        this.cache.delete(workflowId);
        removed++;
      }
    }

    // Enforce max cache size with LRU-style eviction
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const entriesToRemove = this.cache.size - this.MAX_CACHE_SIZE;
      const sortedEntries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      );

      for (let i = 0; i < entriesToRemove; i++) {
        this.cache.delete(sortedEntries[i][0]);
        removed++;
      }
    }

    if (removed > 0) {
      workflowCacheSizeGauge.set(this.cache.size);
      logger.info(
        { removed, cacheSize: this.cache.size, maxSize: this.MAX_CACHE_SIZE },
        "Cleanup completed",
      );
    }
  }

  /**
   * Start periodic cleanup timer (every 60 seconds)
   */
  startCleanupTimer(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // 60 seconds

    logger.info("Cleanup timer started (every 60s)");
  }

  /**
   * Stop periodic cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info("Cleanup timer stopped");
    }
  }
}

export default WorkflowCache.getInstance();
