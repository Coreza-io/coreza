/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { createDedicatedStreamConnection, getRedisCache } from "../config/redis";
import { createLogger } from "../utils/logger";
import { LiveFillRepository, LiveFillRow } from "../repositories/LiveFillRepository";
import { CashSnapshotRepository, CashSnapshotRow } from "../repositories/CashSnapshotRepository";
import { LatestSnapshotState, SnapshotCache } from "../services/SnapshotCache";
import Redis from "ioredis";

const logger = createLogger("FillSyncWorker");

const ACTIVE_STREAMS_KEY = "portfolio:fills:active_streams";
const CONSUMER_GROUP = "fill-sync";
const CONSUMER_NAME = "worker-1";
const BATCH_SIZE = 100;
const BLOCK_TIMEOUT_MS = 2000;
const SNAPSHOT_FLUSH_INTERVAL_MS = 5000;
const DLQ_STREAM = "portfolio:fills:dlq";
const MAX_RETRIES = 5;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * FillSyncWorker — Background service that consumes fill events from
 * workflow-scoped Redis streams and persists them to Supabase in batches.
 *
 * Also flushes coalesced portfolio snapshots on a cadence.
 */
export class FillSyncWorker {
  private static instance: FillSyncWorker;

  private fillLoopRunning = false;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private streamConnection: Redis | null = null;

  /** Track retry counts for poison message detection */
  private retryCounters = new Map<string, number>();

  private constructor() {}

  static getInstance(): FillSyncWorker {
    if (!FillSyncWorker.instance) {
      FillSyncWorker.instance = new FillSyncWorker();
    }
    return FillSyncWorker.instance;
  }

  // ─── Lifecycle ────────────────────────────────────────

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Dedicated connection for blocking XREADGROUP
    this.streamConnection = createDedicatedStreamConnection("FillSync");

    // Start fill consumption loop
    this.fillLoopRunning = true;
    this.runFillLoop().catch((err) => {
      logger.error({ err }, "fill loop crashed");
    });

    // Start snapshot flush interval
    this.snapshotInterval = setInterval(() => {
      this.flushSnapshots().catch((err) => {
        logger.error({ err }, "snapshot flush failed");
      });
    }, SNAPSHOT_FLUSH_INTERVAL_MS);

    logger.info("FillSyncWorker started");
  }

  stop(): void {
    this.isRunning = false;
    this.fillLoopRunning = false;

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    logger.info("FillSyncWorker stopped");
  }

  async flushAll(): Promise<void> {
    logger.info("flushing all pending data before shutdown...");
    try {
      await this.processPendingFills();
      await this.flushSnapshots();
    } catch (err) {
      logger.error({ err }, "flushAll error");
    }

    // Close dedicated stream connection
    if (this.streamConnection) {
      await this.streamConnection.quit().catch(() => {});
      this.streamConnection = null;
    }
  }

  // ─── Fill Consumption Loop ────────────────────────────

  private async runFillLoop(): Promise<void> {
    while (this.fillLoopRunning) {
      try {
        await this.processPendingFills();
      } catch (err) {
        logger.error({ err }, "fill loop iteration error");
        // Brief pause before retrying
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processPendingFills(): Promise<void> {
    const redis = getRedisCache();
    const streamConn = this.streamConnection || redis;

    // Discover active streams
    const activeStreams = await redis.smembers(ACTIVE_STREAMS_KEY);
    if (activeStreams.length === 0) {
      // No active streams, sleep briefly
      await new Promise((r) => setTimeout(r, BLOCK_TIMEOUT_MS));
      return;
    }

    for (const streamKey of activeStreams) {
      // Ensure consumer group exists
      await this.ensureConsumerGroup(redis, streamKey);

      // Read from stream
      let results: any;
      try {
        results = await streamConn.xreadgroup(
          "GROUP", CONSUMER_GROUP, CONSUMER_NAME,
          "COUNT", BATCH_SIZE,
          "BLOCK", BLOCK_TIMEOUT_MS,
          "STREAMS", streamKey, ">"
        );
      } catch (err: any) {
        if (err.message?.includes("NOGROUP")) {
          await this.ensureConsumerGroup(redis, streamKey);
          continue;
        }
        throw err;
      }

      if (!results || results.length === 0) continue;

      // Parse entries from [ [streamKey, [[entryId, [field, value, ...]], ...]] ]
      const [, entries] = results[0];
      if (!entries || entries.length === 0) continue;

      // Dedupe by event_id
      const deduped = new Map<string, { entryId: string; fields: Record<string, string> }>();
      const entryIds: string[] = [];

      for (const [entryId, fieldValues] of entries) {
        entryIds.push(entryId);
        const fields: Record<string, string> = {};
        for (let i = 0; i < fieldValues.length; i += 2) {
          fields[fieldValues[i]] = fieldValues[i + 1];
        }
        const eventId = fields.event_id;
        if (eventId) {
          deduped.set(eventId, { entryId, fields });
        }
      }

      // Map to DB rows
      const rows: LiveFillRow[] = [];
      for (const [, { fields }] of deduped) {
        rows.push({
          event_id: fields.event_id,
          user_id: fields.user_id,
          broker: fields.broker,
          credential_id: fields.credential_id || fields.user_id,
          symbol: fields.symbol,
          trade_id: fields.event_id, // use event_id as trade_id for backward compat
          order_id: fields.order_id || null as any,
          execution_id: fields.execution_id || null as any,
          side: fields.side,
          price: parseFloat(fields.fill_price) || 0,
          qty: parseFloat(fields.fill_qty_delta) || 0,
          quote_qty: fields.quote_qty ? parseFloat(fields.quote_qty) : undefined,
          commission: parseFloat(fields.commission) || 0,
          commission_asset: fields.commission_asset || null as any,
          event_time: fields.event_time,
          workflow_id: fields.workflow_id || null as any,
          run_id: fields.run_id || null as any,
        });
      }

      // Batch upsert to Supabase
      try {
        await LiveFillRepository.batchUpsert(rows);

        // ACK all entries on success
        if (entryIds.length > 0) {
          await redis.xack(streamKey, CONSUMER_GROUP, ...entryIds);
        }

        // Clear retry counters for these entries
        for (const id of entryIds) {
          this.retryCounters.delete(id);
        }

        logger.debug({ stream: streamKey, count: rows.length }, "fills synced");
      } catch (err) {
        // Increment retry counters; move poison messages to DLQ
        for (const entryId of entryIds) {
          const count = (this.retryCounters.get(entryId) || 0) + 1;
          this.retryCounters.set(entryId, count);

          if (count >= MAX_RETRIES) {
            logger.warn({ entryId, stream: streamKey }, "moving poison message to DLQ");
            try {
              // Find the original fields for this entry
              const entry = entries.find(([id]: any) => id === entryId);
              if (entry) {
                const [, fieldValues] = entry;
                await redis.xadd(DLQ_STREAM, "MAXLEN", "~", "10000", "*",
                  "original_stream", streamKey,
                  "original_entry_id", entryId,
                  ...fieldValues
                );
              }
              await redis.xack(streamKey, CONSUMER_GROUP, entryId);
              this.retryCounters.delete(entryId);
            } catch (dlqErr) {
              logger.error({ err: dlqErr, entryId }, "DLQ append failed");
            }
          }
        }

        logger.error({ err, stream: streamKey, count: entryIds.length }, "fill upsert failed, will retry");
      }
    }
  }

  // ─── Snapshot Flush ────────────────────────────────────

  private async flushSnapshots(): Promise<void> {
    const redis = getRedisCache();

    const activeKeys = await redis.smembers(SnapshotCache.ACTIVE_KEYS_SET);
    if (activeKeys.length === 0) return;

    const rows: CashSnapshotRow[] = [];
    const processedKeys: string[] = [];

    for (const key of activeKeys) {
      const json = await redis.get(key);
      if (!json) {
        // Key expired or missing — remove from set
        await redis.srem(SnapshotCache.ACTIVE_KEYS_SET, key);
        continue;
      }

      try {
        const snapshot: LatestSnapshotState = JSON.parse(json);
        const balances =
          snapshot.balances_json && typeof snapshot.balances_json === "object"
            ? (snapshot.balances_json as Record<string, unknown>)
            : {};
        const cash = toFiniteNumber(snapshot.cash);
        const equity = toFiniteNumber(snapshot.equity);
        const realizedPnl = toFiniteNumber(snapshot.realized_pnl);
        const unrealizedPnl = toFiniteNumber(snapshot.unrealized_pnl);

        if (
          cash === null ||
          equity === null ||
          realizedPnl === null ||
          unrealizedPnl === null
        ) {
          logger.warn(
            {
              key,
              base_currency: snapshot.base_currency,
              cash_type: typeof snapshot.cash,
              equity_type: typeof snapshot.equity,
              realized_pnl_type: typeof snapshot.realized_pnl,
              unrealized_pnl_type: typeof snapshot.unrealized_pnl,
              skipped: true,
            },
            "snapshot payload malformed, skipping key",
          );
          await redis.del(key);
          await redis.srem(SnapshotCache.ACTIVE_KEYS_SET, key);
          continue;
        }

        rows.push({
          user_id: snapshot.user_id,
          broker: snapshot.broker,
          credential_id: snapshot.credential_id || snapshot.user_id,
          snapshot_at: snapshot.snapshot_at,
          balances,
          total_value_usdt: equity,
          workflow_id: snapshot.workflow_id || null as any,
          run_id: snapshot.run_id || null as any,
          base_currency: snapshot.base_currency,
          cash,
          equity,
          realized_pnl: realizedPnl,
          unrealized_pnl: unrealizedPnl,
          positions_count: snapshot.positions_count,
        });
        processedKeys.push(key);
      } catch (parseErr) {
        logger.warn({ err: parseErr, key }, "snapshot parse failed, removing");
        await redis.srem(SnapshotCache.ACTIVE_KEYS_SET, key);
      }
    }

    if (rows.length > 0) {
      try {
        await CashSnapshotRepository.batchInsert(rows);

        // Delete flushed keys from Redis and remove from active set
        const pipeline = redis.pipeline();
        for (const key of processedKeys) {
          pipeline.del(key);
          pipeline.srem(SnapshotCache.ACTIVE_KEYS_SET, key);
        }
        await pipeline.exec();

        logger.debug({ count: rows.length }, "snapshots flushed");
      } catch (err) {
        logger.error({ err, count: rows.length }, "snapshot flush to DB failed");
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async ensureConsumerGroup(redis: Redis, streamKey: string): Promise<void> {
    try {
      await redis.xgroup("CREATE", streamKey, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch (err: any) {
      if (!err.message?.includes("BUSYGROUP")) {
        throw err;
      }
      // Group already exists — fine
    }
  }

  // ─── Static API (matches RunSyncService pattern) ──────

  static start(): void {
    FillSyncWorker.getInstance().start();
  }

  static stop(): void {
    FillSyncWorker.getInstance().stop();
  }

  static async flushAll(): Promise<void> {
    await FillSyncWorker.getInstance().flushAll();
  }
}

export default FillSyncWorker;
