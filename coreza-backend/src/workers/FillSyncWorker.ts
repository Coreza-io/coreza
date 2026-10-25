/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import {
  createDedicatedStreamConnection,
  getRedisCache,
} from "../config/redis";
import { createLogger } from "../utils/logger";
import {
  LiveFillRepository,
  LiveFillRow,
} from "../repositories/LiveFillRepository";
import {
  CashSnapshotRepository,
  CashSnapshotRow,
} from "../repositories/CashSnapshotRepository";
import { LatestSnapshotState, SnapshotCache } from "../services/SnapshotCache";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import { supabase } from "../config/supabase";
import { FillEventBus, FillStreamEvent } from "../services/FillEventBus";
import { brokerFillAccountingEnabled } from "../services/OrderFillApplicationService";
import { RedisKeys } from "../infra/redisKeys";

const logger = createLogger("FillSyncWorker");

const CONSUMER_GROUP = "fill-sync";
const CONSUMER_NAME = `worker-${randomUUID()}`;
const BATCH_SIZE = 100;
const BLOCK_TIMEOUT_MS = 2000;
const SNAPSHOT_FLUSH_INTERVAL_MS = 5000;

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
    if (brokerFillAccountingEnabled()) await this.deliverOutbox();
    const redis = getRedisCache();
    const streamConn = this.streamConnection || redis;

    const activeUsers = await redis.smembers(RedisKeys.registryFillsActive());
    if (activeUsers.length === 0) {
      // No active streams, sleep briefly
      await new Promise((r) => setTimeout(r, BLOCK_TIMEOUT_MS));
      return;
    }

    for (const userId of activeUsers) {
      const activeStreamsKey = RedisKeys.userActiveFillStreams(userId);
      const activeStreams = await redis.smembers(activeStreamsKey);
      if (activeStreams.length === 0) {
        await redis.srem(RedisKeys.registryFillsActive(), userId);
        continue;
      }

      for (const streamKey of activeStreams) {
        await this.ensureConsumerGroup(redis, streamKey);

        let results: any;
        try {
          const reclaimed = await redis.xautoclaim(streamKey, CONSUMER_GROUP, CONSUMER_NAME, 30_000, "0-0", "COUNT", BATCH_SIZE) as any;
          results = reclaimed?.[1]?.length ? [[streamKey, reclaimed[1]]] : await streamConn.xreadgroup(
            "GROUP",
            CONSUMER_GROUP,
            CONSUMER_NAME,
            "COUNT",
            BATCH_SIZE,
            "BLOCK",
            BLOCK_TIMEOUT_MS,
            "STREAMS",
            streamKey,
            ">",
          );
        } catch (err: any) {
          if (err.message?.includes("NOGROUP")) {
            await this.ensureConsumerGroup(redis, streamKey);
            continue;
          }
          throw err;
        }

        if (!results || results.length === 0) continue;

        const [, entries] = results[0];
        if (!entries || entries.length === 0) continue;

        const deduped = new Map<
          string,
          { entryId: string; fields: Record<string, string> }
        >();
        const entryIds: string[] = [];

        for (const [entryId, fieldValues] of entries) {
          entryIds.push(entryId);
          const fields: Record<string, string> = {};
          for (let i = 0; i < fieldValues.length; i += 2) {
            fields[fieldValues[i]] = fieldValues[i + 1];
          }
          const dedupeKey = fields.algo_id
            ? fields.broker_account_id ? `algo:${fields.broker_account_id}:${fields.environment || ""}:${fields.algo_id}` : `algo:${fields.algo_id}`
            : fields.fill_id;
          if (!dedupeKey) throw new Error(`Fill ${entryId} is missing its stable identity`);
          if (dedupeKey) {
            deduped.set(dedupeKey, { entryId, fields });
          }
        }

        const rows: LiveFillRow[] = [];
        for (const [fillId, { fields }] of deduped) {
          rows.push({
            user_id: fields.user_id,
            broker: fields.broker,
            credential_id: fields.credential_id || fields.user_id,
            broker_account_id: fields.broker_account_id || "",
            environment: fields.environment || "",
            broker_execution_id: fields.broker_execution_id || undefined,
            symbol: fields.symbol,
            fill_id: fillId,
            order_id: fields.order_id || (null as any),
            side: fields.side,
            price: parseFloat(fields.fill_price) || 0,
            qty: parseFloat(fields.fill_qty_delta) || 0,
            quote_qty: fields.quote_qty
              ? parseFloat(fields.quote_qty)
              : undefined,
            commission: parseFloat(fields.commission) || 0,
            commission_asset: fields.commission_asset || (null as any),
            event_time: fields.event_time,
            workflow_id: fields.workflow_id || (null as any),
            execution_id: fields.execution_id || (null as any),
            fill_status: fields.fill_status || (null as any),
            algo_id: fields.algo_id || (null as any),
            order_type: fields.order_type || (null as any),
            limit_price: fields.limit_price
              ? parseFloat(fields.limit_price)
              : null,
            stop_price: fields.stop_price
              ? parseFloat(fields.stop_price)
              : null,
            trail_percent: fields.trail_percent
              ? parseFloat(fields.trail_percent)
              : fields.trail_percent
                ? parseFloat(fields.trail_percent)
                : null,
            trail_price: fields.trail_price
              ? parseFloat(fields.trail_price)
              : fields.trail_price
                ? parseFloat(fields.trail_price)
                : null,
            timeInForce:
              fields.timeInForce || fields.time_in_force || (null as any),
            tag: fields.tag || (null as any),
          });
        }

        try {
          await LiveFillRepository.batchUpsert(rows);

          if (entryIds.length > 0) {
            await redis.xack(streamKey, CONSUMER_GROUP, ...entryIds);
          }


          logger.debug(
            { stream: streamKey, count: rows.length },
            "fills synced",
          );
        } catch (err) {
          // Keep failed entries pending until the SQL sink succeeds; reclaim after worker restart.
          logger.error(
            { err, stream: streamKey, count: entryIds.length },
            "fill upsert failed, will retry",
          );
        }
      }
    }
  }

  // ─── Snapshot Flush ────────────────────────────────────

  private async deliverOutbox(): Promise<void> {
    const db = supabase as any;
    const { data, error } = await db.from("broker_fill_outbox").select("scope_id,receipt_id,payload")
      .is("delivered_at", null).order("created_at").limit(BATCH_SIZE);
    if (error) throw error;
    for (const row of data ?? []) {
      // Multiple dispatchers may publish the same deterministic fill ID; the sink is idempotent.
      await FillEventBus.publish(row.payload as FillStreamEvent);
      const { error: markError } = await db.from("broker_fill_outbox").update({ delivered_at: new Date().toISOString() })
        .eq("scope_id", row.scope_id).eq("receipt_id", row.receipt_id);
      if (markError) throw markError;
    }
  }

  private async flushSnapshots(): Promise<void> {
    const redis = getRedisCache();
    const activeUsers = await redis.smembers(
      RedisKeys.registrySnapshotsActive(),
    );
    if (activeUsers.length === 0) return;

    for (const userId of activeUsers) {
      const activeKeysSet = SnapshotCache.activeKeysSet(userId);
      const activeKeys = await redis.smembers(activeKeysSet);
      if (activeKeys.length === 0) {
        await redis.srem(RedisKeys.registrySnapshotsActive(), userId);
        continue;
      }

      const rows: CashSnapshotRow[] = [];
      const processedKeys: string[] = [];

      for (const key of activeKeys) {
        const json = await redis.get(key);
        if (!json) {
          await redis.srem(activeKeysSet, key);
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
            await redis.srem(activeKeysSet, key);
            continue;
          }

          rows.push({
            user_id: snapshot.user_id,
            broker: snapshot.broker,
            credential_id: snapshot.credential_id || snapshot.user_id,
            snapshot_at: snapshot.snapshot_at,
            balances,
            total_value_usdt: equity,
            workflow_id: snapshot.workflow_id || (null as any),
            execution_id: snapshot.execution_id || (null as any),
            base_currency: snapshot.base_currency,
            cash,
            equity,
            realized_pnl: realizedPnl,
            unrealized_pnl: unrealizedPnl,
            positions_count: snapshot.positions_count,
          });
          processedKeys.push(key);
        } catch (parseErr) {
          logger.warn(
            { err: parseErr, key },
            "snapshot parse failed, removing",
          );
          await redis.srem(activeKeysSet, key);
        }
      }

      if (rows.length > 0) {
        try {
          await CashSnapshotRepository.batchInsert(rows);

          const pipeline = redis.pipeline();
          for (const key of processedKeys) {
            pipeline.del(key);
            pipeline.srem(activeKeysSet, key);
          }
          pipeline.scard(activeKeysSet);
          const results = await pipeline.exec();
          const lenResult = results?.[results.length - 1];
          const pendingLen =
            lenResult && !lenResult[0] ? Number(lenResult[1] ?? 0) : null;
          if (pendingLen === 0) {
            await redis.srem(RedisKeys.registrySnapshotsActive(), userId);
          }

          logger.debug({ count: rows.length }, "snapshots flushed");
        } catch (err) {
          logger.error(
            { err, count: rows.length },
            "snapshot flush to DB failed",
          );
        }
      }

      const remaining = await redis.scard(activeKeysSet);
      if (remaining === 0) {
        await redis.srem(RedisKeys.registrySnapshotsActive(), userId);
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async ensureConsumerGroup(
    redis: Redis,
    streamKey: string,
  ): Promise<void> {
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
