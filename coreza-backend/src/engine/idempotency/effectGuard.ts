import { getRedisCache } from "../../config/redis";
import { RedisKeys } from "../../infra/redisKeys";
import { randomUUID } from "crypto";

const EFFECT_TTL_SECONDS = 7 * 24 * 60 * 60;
const EFFECT_CLAIM_LEASE_SECONDS = 120;

type StoredEffect<TResult> =
  | { status: "running"; ownerToken: string }
  | { status: "complete"; result: TResult };

export interface EffectScope {
  userId: string;
  workflowId: string;
  executionId: string;
}

/** Runs an external effect once and replays its serialized result on retries. */
export async function runOnce<TResult>(
  scope: EffectScope,
  key: string,
  fn: () => Promise<TResult>,
): Promise<TResult> {
  const redis = getRedisCache();
  const redisKey = RedisKeys.effectGuard(
    `${scope.userId}:${scope.workflowId}:${scope.executionId}`,
    key,
  );
  const ownerToken = randomUUID();
  const claimed = await redis.set(
    redisKey,
    JSON.stringify({ status: "running", ownerToken } satisfies StoredEffect<TResult>),
    "EX", EFFECT_CLAIM_LEASE_SECONDS, "NX",
  );
  if (claimed !== "OK") {
    const existing = await redis.get(redisKey);
    if (existing) {
      const stored = JSON.parse(existing) as StoredEffect<TResult>;
      if (stored.status === "complete") return stored.result;
    }
    throw new Error("EFFECT_IN_FLIGHT");
  }
  try {
    const result = await fn();
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end`;
    const running = JSON.stringify({ status: "running", ownerToken } satisfies StoredEffect<TResult>);
    const complete = JSON.stringify({ status: "complete", result } satisfies StoredEffect<TResult>);
    if (await redis.eval(script, 1, redisKey, running, complete, String(EFFECT_TTL_SECONDS)) !== 1) {
      throw new Error("Effect ownership was lost before completion");
    }
    return result;
  } catch (error) {
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await redis.eval(script, 1, redisKey, JSON.stringify({ status: "running", ownerToken } satisfies StoredEffect<TResult>));
    throw error;
  }
}

export function effectKey(runOrEmissionId: string, nodeId: string, discriminator: string): string {
  return `${runOrEmissionId}:${nodeId}:${discriminator}`;
}
