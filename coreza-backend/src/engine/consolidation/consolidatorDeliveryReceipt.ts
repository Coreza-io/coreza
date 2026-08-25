import { getRedisCache } from "../../config/redis";
import { RedisKeys } from "../../infra/redisKeys";
import { createHash } from "crypto";

const DEFAULT_DELIVERY_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

function receiptTtlSeconds(): number {
  const configured = Number(process.env.CONSOLIDATOR_DELIVERY_RECEIPT_TTL_SECONDS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DELIVERY_RECEIPT_TTL_SECONDS;
}

function claimLeaseSeconds(): number {
  const configured = Number(process.env.CONSOLIDATOR_CLAIM_LEASE_SECONDS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 120;
}

export function emissionBatchHash(emissionIds: readonly string[]): string {
  return createHash("sha256").update([...emissionIds].sort().join("\n")).digest("hex");
}

export async function claimEmissionBatch(
  userId: string,
  workflowId: string,
  executionId: string,
  emissionIds: readonly string[],
  ownerToken: string,
): Promise<boolean> {
  const key = RedisKeys.consolidatorClaim(userId, workflowId, executionId, emissionBatchHash(emissionIds));
  return (await getRedisCache().set(key, ownerToken, "EX", claimLeaseSeconds(), "NX")) === "OK";
}

export async function releaseEmissionClaim(
  userId: string,
  workflowId: string,
  executionId: string,
  emissionIds: readonly string[],
  ownerToken: string,
): Promise<boolean> {
  const key = RedisKeys.consolidatorClaim(userId, workflowId, executionId, emissionBatchHash(emissionIds));
  const result = await getRedisCache().eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1, key, ownerToken,
  );
  return result === 1;
}

export async function markEmissionDelivered(
  userId: string,
  workflowId: string,
  executionId: string,
  emissionIds: readonly string[],
  ownerToken: string,
): Promise<boolean> {
  if (emissionIds.length === 0) return false;
  const claimKey = RedisKeys.consolidatorClaim(userId, workflowId, executionId, emissionBatchHash(emissionIds));
  const receiptKeys = emissionIds.map((id) => RedisKeys.consolidatorDelivery(userId, executionId, id));
  const script = `
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
    for i = 2, #KEYS do redis.call('set', KEYS[i], ARGV[2], 'EX', ARGV[3]) end
    redis.call('del', KEYS[1])
    return 1`;
  const result = await getRedisCache().eval(
    script, receiptKeys.length + 1, claimKey, ...receiptKeys,
    ownerToken, new Date().toISOString(), String(receiptTtlSeconds()),
  );
  return result === 1;
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
