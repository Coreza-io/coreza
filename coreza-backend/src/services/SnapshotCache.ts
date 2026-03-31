/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { getRedisCache } from "../config/redis";

const ACTIVE_KEYS_SET = "portfolio:snapshots:active_keys";
const SNAPSHOT_TTL = 86400; // 24 hours

export interface LatestSnapshotState {
  user_id: string;
  workflow_id: string;
  run_id?: string;
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
  static async upsertLatest(snapshot: LatestSnapshotState): Promise<void> {
    const redis = getRedisCache();
    const key = `${snapshot.user_id}:${snapshot.workflow_id}:portfolio:snapshot:latest`;

    const pipeline = redis.pipeline();
    pipeline.set(key, JSON.stringify(snapshot), "EX", SNAPSHOT_TTL);
    pipeline.sadd(ACTIVE_KEYS_SET, key);
    await pipeline.exec();
  }

  /** Return set key name for the worker to discover active snapshot keys. */
  static get ACTIVE_KEYS_SET() {
    return ACTIVE_KEYS_SET;
  }
}
