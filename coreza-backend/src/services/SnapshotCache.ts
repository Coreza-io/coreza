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
   * Only the most recent state per workflow is kept.
   * Fire-and-forget — caller should NOT await this.
   */
  private static pending = new Map<string, LatestSnapshotState>();
  private static writes = new Map<string, Promise<void>>();

  static upsertLatest(snapshot: LatestSnapshotState): Promise<void> {
    const key = RedisKeys.portfolioSnapshotLatest(snapshot.user_id, snapshot.workflow_id, snapshot.execution_id);
    this.pending.set(key, snapshot);
    const previous = this.writes.get(key) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => this.persist(snapshot)).then(() => {
      if (this.pending.get(key) === snapshot) this.pending.delete(key);
    }).finally(() => { if (this.writes.get(key) === write) this.writes.delete(key); });
    this.writes.set(key, write);
    return write;
  }

  static async drain(userId: string, workflowId: string, executionId?: string): Promise<void> {
    const rows = [...this.pending.entries()].filter(([, row]) => row.user_id === userId && row.workflow_id === workflowId && (!executionId || row.execution_id === executionId));
    await Promise.allSettled(rows.map(([key]) => this.writes.get(key)));
    for (const [key] of rows) {
      const pending = this.pending.get(key);
      if (pending) await this.upsertLatest(pending);
    }
  }

  private static async persist(snapshot: LatestSnapshotState): Promise<void> {
    const redis = getRedisCache();
    const key = RedisKeys.portfolioSnapshotLatest(snapshot.user_id, snapshot.workflow_id, snapshot.execution_id);
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
