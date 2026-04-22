/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { getRedisCache } from "../config/redis";
import { RedisKeys } from "../infra/redisKeys";

const SNAPSHOT_TTL = 86400; // 24 hours
const MANUAL_SNAPSHOT_TTL = 3600; // 1 hour

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
  static async upsertLatest(
    snapshot: LatestSnapshotState,
    options?: { manual?: boolean },
  ): Promise<void> {
    const isManual = options?.manual === true;
    if (isManual && process.env.ENABLE_MANUAL_STREAM_REDIS !== "true") {
      return;
    }

    const redis = getRedisCache();
    const key = isManual
      ? RedisKeys.manualPortfolioSnapshotLatest(
          snapshot.user_id,
          snapshot.workflow_id,
        )
      : RedisKeys.portfolioSnapshotLatest(snapshot.user_id, snapshot.workflow_id);
    const activeKeysSet = RedisKeys.userActiveSnapshotKeys(snapshot.user_id);

    const pipeline = redis.pipeline();
    pipeline.set(
      key,
      JSON.stringify(snapshot),
      "EX",
      isManual ? MANUAL_SNAPSHOT_TTL : SNAPSHOT_TTL,
    );
    pipeline.sadd(activeKeysSet, key);
    pipeline.sadd(RedisKeys.registrySnapshotsActive(), snapshot.user_id);
    await pipeline.exec();
  }

  static activeKeysSet(userId: string): string {
    return RedisKeys.userActiveSnapshotKeys(userId);
  }
}
