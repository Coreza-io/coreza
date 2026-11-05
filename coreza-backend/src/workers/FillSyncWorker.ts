import { LiveStrategiesRepository } from "../repositories/LiveStrategiesRepository";
import { LiveTradeRepository } from "../repositories/LiveTradeRepository";
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
import { CashSnapshotRepository } from "../repositories/CashSnapshotRepository";
import { LatestSnapshotState, SnapshotCache } from "../services/SnapshotCache";
import Redis from "ioredis";
import { RedisKeys } from "../infra/redisKeys";

const logger = createLogger("FillSyncWorker");

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
      this.flushReporting().catch((err) => {
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
      await this.flushReporting();
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
          results = await streamConn.xreadgroup(
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
            ? `algo:${fields.algo_id}`
            : fields.fill_id;
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

          for (const id of entryIds) {
            this.retryCounters.delete(id);
          }

          logger.debug(
            { stream: streamKey, count: rows.length },
            "fills synced",
          );
        } catch (err) {
          for (const entryId of entryIds) {
            const count = (this.retryCounters.get(entryId) || 0) + 1;
            this.retryCounters.set(entryId, count);

            if (count >= MAX_RETRIES) {
              logger.warn(
                { entryId, stream: streamKey },
                "moving poison message to DLQ",
              );
              try {
                const entry = entries.find(([id]: any) => id === entryId);
                if (entry) {
                  const [, fieldValues] = entry;
                  await redis.xadd(
                    DLQ_STREAM,
                    "MAXLEN",
                    "~",
                    "10000",
                    "*",
                    "original_stream",
                    streamKey,
                    "original_entry_id",
                    entryId,
                    ...fieldValues,
                  );
                }
                await redis.xack(streamKey, CONSUMER_GROUP, entryId);
                this.retryCounters.delete(entryId);
              } catch (dlqErr) {
                logger.error({ err: dlqErr, entryId }, "DLQ append failed");
              }
            }
          }

          logger.error(
            { err, stream: streamKey, count: entryIds.length },
            "fill upsert failed, will retry",
          );
        }
      }
    }
  }

  // ─── Snapshot Flush ────────────────────────────────────

  private snapshotFlush: Promise<void> = Promise.resolve();

  private reportingFlush: Promise<void> | null = null;

  private flushReporting(): Promise<void> {
    if (this.reportingFlush) return this.reportingFlush;
    const flush = this.persistReporting().finally(() => { this.reportingFlush = null; });
    this.reportingFlush = flush;
    return flush;
  }

  private async persistReporting(): Promise<void> {
    const writes = await Promise.allSettled([LiveTradeRepository.flush(), SnapshotCache.drain()]);
    const snapshots = await Promise.allSettled([this.flushSnapshots()]);
    await LiveStrategiesRepository.recoverPending();
    await LiveStrategiesRepository.refreshDirty();
    const failures = [...writes, ...snapshots].filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Reporting flush incomplete");
  }

  private flushSnapshots(scope?: { userId: string; workflowId: string; executionId?: string }): Promise<void> {
    const flush = this.snapshotFlush.catch(() => undefined).then(() => this.persistSnapshots(scope));
    this.snapshotFlush = flush;
    return flush;
  }

  private async persistSnapshots(scope?: { userId: string; workflowId: string; executionId?: string }): Promise<void> {
    const redis = getRedisCache();
    const users = scope ? [scope.userId] : await redis.smembers(RedisKeys.registrySnapshotsActive());
    const failures: unknown[] = [];
    for (const userId of users) {
      const activeSet = SnapshotCache.activeKeysSet(userId);
      for (const key of await redis.smembers(activeSet)) {
        if (scope && !key.startsWith(RedisKeys.portfolioSnapshotLatest(scope.userId, scope.workflowId, scope.executionId))) continue;
        const json = await redis.get(key);
        if (!json) {
          await redis.eval(`if redis.call('EXISTS',KEYS[1]) == 0 then redis.call('SREM',KEYS[2],KEYS[1]); if redis.call('SCARD',KEYS[2]) == 0 then redis.call('SREM',KEYS[3],ARGV[1]) end end`,
            3, key, activeSet, RedisKeys.registrySnapshotsActive(), userId);
          continue;
        }
        try {
          const snapshot: LatestSnapshotState = JSON.parse(json);
          if (!snapshot.id) throw new Error(`Snapshot retry ID missing: ${key}`);
          if (scope && (snapshot.workflow_id !== scope.workflowId || (scope.executionId && snapshot.execution_id !== scope.executionId))) continue;
          if (!snapshot.workflow_id || !snapshot.execution_id) {
            throw new Error(`Portfolio snapshot missing activation scope, retained for recovery: ${key}`);
          }
          const cash = toFiniteNumber(snapshot.cash);
          const equity = toFiniteNumber(snapshot.equity);
          const realized = toFiniteNumber(snapshot.realized_pnl);
          const unrealized = toFiniteNumber(snapshot.unrealized_pnl);
          if (cash === null || equity === null || realized === null || unrealized === null) {
            throw new Error(`Malformed portfolio snapshot retained for recovery: ${key}`);
          }
          await CashSnapshotRepository.batchInsert([{
            id: snapshot.id, user_id: snapshot.user_id, workflow_id: snapshot.workflow_id,
            execution_id: snapshot.execution_id, broker: snapshot.broker,
            credential_id: snapshot.credential_id || snapshot.user_id,
            snapshot_at: snapshot.snapshot_at, base_currency: snapshot.base_currency,
            balances: snapshot.balances_json && typeof snapshot.balances_json === "object" ? snapshot.balances_json as Record<string, unknown> : {},
            cash, equity, realized_pnl: realized, unrealized_pnl: unrealized,
            positions_count: snapshot.positions_count, total_value_usdt: equity,
          }]);
          // Compare and delete atomically: a newer coalesced snapshot must survive.
          await redis.eval(`
            if redis.call('GET', KEYS[1]) == ARGV[1] then
              redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], KEYS[1])
              if redis.call('SCARD', KEYS[2]) == 0 then redis.call('SREM', KEYS[3], ARGV[2]) end
              return 1
            end
            return 0`, 3, key, activeSet, RedisKeys.registrySnapshotsActive(), json, userId);
        } catch (error) { failures.push(error); }
      }
    }
    if (failures.length) throw new AggregateError(failures, "Portfolio snapshots require retry");
  }

  static async flushWorkflow(userId: string, workflowId: string, executionId?: string): Promise<void> {
    await SnapshotCache.drain(userId, workflowId, executionId);
    await LiveTradeRepository.flush(executionId, workflowId, userId);
    await this.getInstance().flushSnapshots({ userId, workflowId, executionId });
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
