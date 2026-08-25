/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import crypto from "crypto";
import { getRedisCache } from "../config/redis";
import { RedisKeys } from "../infra/redisKeys";

export interface OrderIdempotencyParams {
  workflowId: string;
  nodeId: string;
  runId: string;
  symbol: string;
  side: string;
  quantity: string | number;
}

export interface CachedOrder {
  idempotencyKey: string;
  status: "pending" | "success" | "failed";
  orderId?: string;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
  ownerToken: string;
  broker: string;
}

const DEFAULT_ORDER_CACHE_TTL_SECONDS = 86_400;

function orderCacheTtlSeconds(): number {
  const orderTtl = Number(process.env.ORDER_CACHE_TTL_SECONDS);
  const receiptTtl = Number(process.env.CONSOLIDATOR_DELIVERY_RECEIPT_TTL_SECONDS);
  const validOrderTtl = Number.isSafeInteger(orderTtl) && orderTtl > 0 ? orderTtl : DEFAULT_ORDER_CACHE_TTL_SECONDS;
  const validReceiptTtl = Number.isSafeInteger(receiptTtl) && receiptTtl > 0 ? receiptTtl : 7 * 24 * 60 * 60;
  return Math.max(validOrderTtl, validReceiptTtl);
}

function normalizeValue(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * Generate deterministic idempotency key from order parameters.
 * Same inputs always produce same key.
 */
export function generateIdempotencyKey(params: OrderIdempotencyParams): string {
  const data = [
    normalizeValue(params.workflowId),
    normalizeValue(params.nodeId),
    normalizeValue(params.runId),
    normalizeValue(params.symbol).toUpperCase(),
    normalizeValue(params.side).toUpperCase(),
    normalizeValue(params.quantity),
  ].join("|");

  return crypto.createHash("sha256").update(data).digest("hex").substring(0, 32);
}

/**
 * Check if order already exists in cache.
 */
export async function getOrderFromCache(
  userId: string,
  workflowId: string,
  idempotencyKey: string
): Promise<CachedOrder | null> {
  const redis = getRedisCache();
  const cached = await redis.get(RedisKeys.order(userId, workflowId, idempotencyKey));
  if (!cached) return null;
  const parsed = JSON.parse(cached) as Partial<CachedOrder>;
  if (!parsed.idempotencyKey || !parsed.status || !parsed.createdAt || !parsed.broker) return null;
  return {
    ...parsed,
    idempotencyKey: parsed.idempotencyKey,
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt ?? parsed.createdAt,
    ownerToken: parsed.ownerToken ?? "__legacy__",
    broker: parsed.broker,
  };
}

/** Atomically claims ownership of a broker submission. */
export async function claimOrderIntent(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  broker: string,
  ownerToken: string,
): Promise<{ claimed: true } | { claimed: false; existing: CachedOrder | null }> {
  const redis = getRedisCache();
  const now = new Date().toISOString();
  const order: CachedOrder = {
    idempotencyKey, status: "pending", createdAt: now, updatedAt: now, broker, ownerToken,
  };
  const ttl = orderCacheTtlSeconds();
  const key = RedisKeys.order(userId, workflowId, idempotencyKey);
  const claimed = await redis.set(key, JSON.stringify(order), "EX", ttl, "NX");
  if (claimed !== "OK") {
    return { claimed: false, existing: await getOrderFromCache(userId, workflowId, idempotencyKey) };
  }
  await redis.set(RedisKeys.orderReverse(userId, workflowId, idempotencyKey), idempotencyKey, "EX", ttl);
  return { claimed: true };
}

/** Updates an order only while the caller still owns its claim. */
export async function updateOrderCache(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  ownerToken: string,
  status: "pending" | "success" | "failed",
  result: unknown,
  orderId?: string,
): Promise<boolean> {
  const redis = getRedisCache();
  const key = RedisKeys.order(userId, workflowId, idempotencyKey);
  const script = `
    local current = redis.call('get', KEYS[1])
    if not current then return 0 end
    local decoded = cjson.decode(current)
    if decoded.ownerToken ~= ARGV[1] then return 0 end
    decoded.status = ARGV[2]
    decoded.result = cjson.decode(ARGV[3])
    decoded.updatedAt = ARGV[4]
    if ARGV[5] ~= '' then decoded.orderId = ARGV[5] end
    redis.call('set', KEYS[1], cjson.encode(decoded), 'EX', ARGV[6])
    return 1`;
  const updated = await redis.eval(script, 1, key, ownerToken, status, JSON.stringify(result ?? null),
    new Date().toISOString(), orderId ?? "", String(orderCacheTtlSeconds()));
  if (updated === 1 && orderId) {
    await redis.set(RedisKeys.orderReverse(userId, workflowId, orderId), idempotencyKey, "EX", orderCacheTtlSeconds());
  }
  return updated === 1;
}

export async function takeOverOrderIntent(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  expectedOwnerToken: string,
  expectedUpdatedAt: string,
  ownerToken: string,
): Promise<boolean> {
  const redis = getRedisCache();
  const key = RedisKeys.order(userId, workflowId, idempotencyKey);
  const updatedAt = new Date().toISOString();
  const script = `
    local current = redis.call('get', KEYS[1])
    if not current then return 0 end
    local decoded = cjson.decode(current)
    local currentOwner = decoded.ownerToken or '__legacy__'
    local currentUpdatedAt = decoded.updatedAt or decoded.createdAt
    if currentOwner ~= ARGV[1] or currentUpdatedAt ~= ARGV[2] then return 0 end
    if decoded.status ~= 'pending' and decoded.status ~= 'failed' then return 0 end
    decoded.ownerToken = ARGV[3]
    decoded.status = 'pending'
    decoded.updatedAt = ARGV[4]
    decoded.result = nil
    redis.call('set', KEYS[1], cjson.encode(decoded), 'EX', ARGV[5])
    return 1`;
  return await redis.eval(
    script,
    1,
    key,
    expectedOwnerToken,
    expectedUpdatedAt,
    ownerToken,
    updatedAt,
    String(orderCacheTtlSeconds()),
  ) === 1;
}

export async function cacheReconciledOrder(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  expectedOwnerToken: string,
  expectedUpdatedAt: string,
  result: unknown,
  orderId?: string,
): Promise<boolean> {
  const redis = getRedisCache();
  const key = RedisKeys.order(userId, workflowId, idempotencyKey);
  const script = `
    local current = redis.call('get', KEYS[1])
    if not current then return 0 end
    local decoded = cjson.decode(current)
    local currentOwner = decoded.ownerToken or '__legacy__'
    local currentUpdatedAt = decoded.updatedAt or decoded.createdAt
    if currentOwner ~= ARGV[1] or currentUpdatedAt ~= ARGV[2] or decoded.status ~= 'pending' then return 0 end
    decoded.status = 'success'
    decoded.result = cjson.decode(ARGV[3])
    decoded.updatedAt = ARGV[4]
    if ARGV[5] ~= '' then decoded.orderId = ARGV[5] end
    redis.call('set', KEYS[1], cjson.encode(decoded), 'EX', ARGV[6])
    return 1`;
  const updated = await redis.eval(
    script,
    1,
    key,
    expectedOwnerToken,
    expectedUpdatedAt,
    JSON.stringify(result),
    new Date().toISOString(),
    orderId ?? "",
    String(orderCacheTtlSeconds()),
  );
  if (updated === 1 && orderId) {
    await redis.set(RedisKeys.orderReverse(userId, workflowId, orderId), idempotencyKey, "EX", orderCacheTtlSeconds());
  }
  return updated === 1;
}

/**
 * Check if an orderId was placed by this system (exists in Redis reverse index).
 * Returns the cached order if found, null otherwise.
 */
export async function isOurOrder(
  userId: string,
  workflowId: string,
  orderId: string,
): Promise<{ ours: boolean; order?: CachedOrder }> {
  const redis = getRedisCache();
  const idempotencyKey = await redis.get(
    RedisKeys.orderReverse(userId, workflowId, orderId),
  );
  if (!idempotencyKey) {
    return { ours: false };
  }
  const order = await getOrderFromCache(userId, workflowId, idempotencyKey);
  return { ours: true, order: order ?? undefined };
}
