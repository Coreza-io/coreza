/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getRedisCache } from "../config/redis";
import { RedisKeys } from "../infra/redisKeys";

const SNAPSHOT_TTL = 86400; // 24 hours

export interface LatestSnapshotState {
  id: string;
  user_id: string;
  workflow_id: string;
  execution_id?: string;
  broker: string;
  credential_id?: string;
  snapshot_at: string;
  base_currency?: string;
  cash?: number;
  equity?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  positions_count?: number;
  balances_json?: unknown;
}

export class SnapshotCache {
  /**
   * Upsert the latest coalesced portfolio snapshot into Redis.
   * Only the most recent state per activation/account/currency source is kept.
   * Fire-and-forget — caller should NOT await this.
   */
  private static pending = new Map<string, LatestSnapshotState>();
  private static writes = new Map<string, Promise<void>>();

  private static key(snapshot: LatestSnapshotState): string {
    return RedisKeys.portfolioSnapshotLatest(snapshot.user_id, snapshot.workflow_id, snapshot.execution_id,
      `${snapshot.broker}:${snapshot.credential_id ?? snapshot.user_id}:${snapshot.base_currency ?? ""}`);
  }

  static upsertLatest(snapshot: LatestSnapshotState): Promise<void> {
    if (!snapshot.id) return Promise.reject(new Error("Snapshot retry ID is required"));
    const key = this.key(snapshot);
    this.pending.set(key, snapshot);
    const existing = this.writes.get(key);
    if (existing) return existing;
    // One writer per coalesced key; a slow Redis connection never queues every mutation.
    const write = (async () => {
      while (this.pending.has(key)) {
        const latest = this.pending.get(key)!;
        await this.persist(latest);
        if (this.pending.get(key) === latest) this.pending.delete(key);
      }
    })().finally(() => { this.writes.delete(key); });
    this.writes.set(key, write);
    return write;
  }

  static async drain(userId?: string, workflowId?: string, executionId?: string): Promise<void> {
    const rows = [...this.pending.entries()].filter(([, row]) => (!userId || row.user_id === userId) && (!workflowId || row.workflow_id === workflowId) && (!executionId || row.execution_id === executionId));
    const settled = await Promise.allSettled(rows.map(async ([key]) => {
      await this.writes.get(key)?.catch(() => undefined);
      const pending = this.pending.get(key);
      if (pending) await this.upsertLatest(pending);
    }));
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Snapshot cache drain incomplete");
  }

  private static async persist(snapshot: LatestSnapshotState): Promise<void> {
    const redis = getRedisCache();
    const key = this.key(snapshot);
    const activeKeysSet = RedisKeys.userActiveSnapshotKeys(snapshot.user_id);

    const pipeline = redis.multi();
    pipeline.set(key, JSON.stringify(snapshot), "EX", SNAPSHOT_TTL);
    pipeline.sadd(activeKeysSet, key);
    pipeline.sadd(RedisKeys.registrySnapshotsActive(), snapshot.user_id);
    const results = await pipeline.exec();
    const failure = results?.find(([error]) => error);
    if (failure?.[0]) throw failure[0];
  }

  static activeKeysSet(userId: string): string {
    return RedisKeys.userActiveSnapshotKeys(userId);
  }
}
