import crypto from "crypto";
import { getRedis } from "../config/redis";

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
  idempotencyKey: string
): Promise<CachedOrder | null> {
  const redis = getRedis();
  const cached = await redis.get(`order:${idempotencyKey}`);
  return cached ? JSON.parse(cached) : null;
}

/**
 * Cache order intent before submission.
 */
export async function cacheOrderIntent(
  idempotencyKey: string,
  broker: string
): Promise<void> {
  const redis = getRedis();
  const order: CachedOrder = {
    idempotencyKey,
    status: "pending",
    createdAt: new Date().toISOString(),
    broker,
  };
  await redis.setex(`order:${idempotencyKey}`, ORDER_CACHE_TTL, JSON.stringify(order));
}

/**
 * Update cache with order result.
 */
export async function updateOrderCache(
  idempotencyKey: string,
  status: "success" | "failed",
  result: any,
  orderId?: string
): Promise<void> {
  const redis = getRedis();
  const existing = await getOrderFromCache(idempotencyKey);
  if (existing) {
    const updated: CachedOrder = {
      ...existing,
      status,
      result,
      orderId,
    };
    await redis.setex(`order:${idempotencyKey}`, ORDER_CACHE_TTL, JSON.stringify(updated));
  }
}
