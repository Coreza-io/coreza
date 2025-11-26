import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
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
  async getWorkflow(workflowId: string, ttlMs: number = this.DEFAULT_TTL_MS): Promise<any | null> {
    // Check cache first
    const cached = this.cache.get(workflowId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`✅ [WorkflowCache] Cache HIT for workflow ${workflowId}`);
      return cached.workflow;
    }

    // Cache miss - fetch from Supabase
    console.log(`🔍 [WorkflowCache] Cache MISS for workflow ${workflowId}, fetching...`);
    
    try {
      const { data: workflow, error } = await this.supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .eq('is_active', true)
        .single();

      if (error) {
        console.error(`❌ [WorkflowCache] Failed to fetch workflow ${workflowId}:`, error);
        return null;
      }

      if (!workflow) {
        console.warn(`⚠️ [WorkflowCache] Workflow ${workflowId} not found or inactive`);
        return null;
      }

      // Cache the result
      this.cache.set(workflowId, {
        workflow,
        expiresAt: Date.now() + ttlMs,
      });

      console.log(`✅ [WorkflowCache] Cached workflow ${workflowId} for ${ttlMs}ms`);
      return workflow;
    } catch (error) {
      console.error(`❌ [WorkflowCache] Error fetching workflow:`, error);
      return null;
    }
  }

  /**
   * Invalidate specific workflow from cache
   */
  invalidate(workflowId: string): void {
    this.cache.delete(workflowId);
    console.log(`🗑️ [WorkflowCache] Invalidated cache for workflow ${workflowId}`);
  }

  /**
   * Invalidate all cached workflows
   */
  invalidateAll(): void {
    this.cache.clear();
    console.log(`🗑️ [WorkflowCache] Cleared all cached workflows`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: Array<{ workflowId: string; expiresIn: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([workflowId, cached]) => ({
      workflowId,
      expiresIn: Math.max(0, cached.expiresAt - now),
    }));

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
      const sortedEntries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      
      for (let i = 0; i < entriesToRemove; i++) {
        this.cache.delete(sortedEntries[i][0]);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`🧹 [WorkflowCache] Cleaned up ${removed} entries (${this.cache.size}/${this.MAX_CACHE_SIZE})`);
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
    
    console.log('🧹 [WorkflowCache] Started cleanup timer (every 60s)');
  }

  /**
   * Stop periodic cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🧹 [WorkflowCache] Stopped cleanup timer');
    }
  }
}

export default WorkflowCache.getInstance();
