import { getRedisCache } from "../../config/redis";
import { RedisKeys } from "../../infra/redisKeys";

const DEFAULT_DELIVERY_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

function receiptTtlSeconds(): number {
  const configured = Number(process.env.CONSOLIDATOR_DELIVERY_RECEIPT_TTL_SECONDS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DELIVERY_RECEIPT_TTL_SECONDS;
}

export async function findDeliveredEmissionIds(
  userId: string,
  executionId: string,
  emissionIds: readonly string[],
): Promise<Set<string>> {
  if (emissionIds.length === 0) return new Set();
  const redis = getRedisCache();
  const values = await redis.mget(
    ...emissionIds.map((emissionId) => RedisKeys.consolidatorDelivery(userId, executionId, emissionId)),
  );
  return new Set(emissionIds.filter((_, index) => values[index] !== null));
}

export async function recordDeliveredEmissions(
  userId: string,
  executionId: string,
  emissionIds: readonly string[],
): Promise<void> {
  if (emissionIds.length === 0) return;
  const redis = getRedisCache();
  const ttl = receiptTtlSeconds();
  await Promise.all(emissionIds.map((emissionId) =>
    redis.set(
      RedisKeys.consolidatorDelivery(userId, executionId, emissionId),
      new Date().toISOString(),
      "EX",
      ttl,
      "NX",
    )));
}
