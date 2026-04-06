/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
  result?: any;
  createdAt: string;
  broker: string;
}

const ORDER_CACHE_TTL = 86400; // 24 hours in seconds

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
  return cached ? JSON.parse(cached) : null;
}

/**
 * Cache order intent before submission.
 */
export async function cacheOrderIntent(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  broker: string
): Promise<void> {
  const redis = getRedisCache();
  const order: CachedOrder = {
    idempotencyKey,
    status: "pending",
    createdAt: new Date().toISOString(),
    broker,
  };
  await Promise.all([
    redis.setex(
      RedisKeys.order(userId, workflowId, idempotencyKey),
      ORDER_CACHE_TTL,
      JSON.stringify(order),
    ),
    // Pre-register reverse index: idempotency key IS the client_order_id sent to brokers.
    // This ensures fills arriving before updateOrderCache() can still be verified.
    redis.setex(
      RedisKeys.orderReverse(userId, workflowId, idempotencyKey),
      ORDER_CACHE_TTL,
      idempotencyKey,
    ),
  ]);
}

/**
 * Update cache with order result.
 * Also creates a scoped reverse index (`...:orderReverse:{orderId}` → idempotencyKey)
 * so we can look up whether an incoming orderId belongs to us.
 */
export async function updateOrderCache(
  userId: string,
  workflowId: string,
  idempotencyKey: string,
  status: "success" | "failed",
  result: any,
  orderId?: string
): Promise<void> {
  const redis = getRedisCache();
  const existing = await getOrderFromCache(userId, workflowId, idempotencyKey);
  if (existing) {
    const updated: CachedOrder = {
      ...existing,
      status,
      result,
      orderId,
    };
    await redis.setex(
      RedisKeys.order(userId, workflowId, idempotencyKey),
      ORDER_CACHE_TTL,
      JSON.stringify(updated),
    );

    // Create reverse index for order ownership verification
    if (orderId) {
      await redis.setex(
        RedisKeys.orderReverse(userId, workflowId, orderId),
        ORDER_CACHE_TTL,
        idempotencyKey,
      );
    }
  }
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
