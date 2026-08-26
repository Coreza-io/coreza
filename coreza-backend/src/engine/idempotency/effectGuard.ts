import { createHash, randomUUID } from "crypto";
import { getRedisCache } from "../../config/redis";
import { RedisKeys } from "../../infra/redisKeys";

const EFFECT_TTL_SECONDS = 7 * 24 * 60 * 60;
const EFFECT_CLAIM_LEASE_SECONDS = 120;

type StoredEffect<TResult> =
  | { status: "pending"; ownerToken: string; attemptedAt: string }
  | { status: "complete"; result: TResult }
  | { status: "failed"; attemptedAt: string; error: string }
  | { status: "unknown"; attemptedAt: string; error: string };

export interface EffectScope {
  userId: string;
  workflowId: string;
  executionId: string;
}

export interface EffectKeyInput {
  scopeId: string;
  nodeId: string;
  operation: string;
  params: unknown;
  invocationIndex?: number;
}

export interface RunOnceOptions<TResult> {
  reconcile?: () => Promise<TResult | null>;
}

export class EffectOutcomeUnknownError extends Error {
  readonly code = "EFFECT_OUTCOME_UNKNOWN";

  constructor(readonly originalError: string) {
    super(`EFFECT_OUTCOME_UNKNOWN: ${originalError}`);
    this.name = "EffectOutcomeUnknownError";
  }
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function effectKey(input: EffectKeyInput): string {
  const hash = createHash("sha256").update(stableStringify(input.params)).digest("hex");
  const index = input.invocationIndex === undefined ? "" : `:${input.invocationIndex}`;
  return `${input.scopeId}:${input.nodeId}:${input.operation}:${hash}${index}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownOutcome(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: string;
    name?: string;
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const code = candidate.code?.toUpperCase();
  const message = candidate.message?.toLowerCase() ?? "";
  if (["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "UND_ERR_ABORTED"].includes(code ?? "")) return true;
  if (candidate.name === "AbortError" || /socket hang up|timed? ?out|aborted/.test(message)) return true;
  return (candidate.response?.status ?? 0) >= 500 &&
    (candidate.response?.data === undefined || candidate.response.data === null || candidate.response.data === "");
}

/** Runs an external effect once and replays its serialized result on retries. */
export async function runOnce<TResult>(
  scope: EffectScope,
  key: string,
  fn: () => Promise<TResult>,
  options: RunOnceOptions<TResult> = {},
): Promise<TResult> {
  const redis = getRedisCache();
  const redisKey = RedisKeys.effectGuard(`${scope.userId}:${scope.workflowId}:${scope.executionId}`, key);
  const ownerToken = randomUUID();
  const attemptedAt = new Date().toISOString();
  const pending: StoredEffect<TResult> = { status: "pending", ownerToken, attemptedAt };
  const claimed = await redis.set(redisKey, JSON.stringify(pending), "EX", EFFECT_CLAIM_LEASE_SECONDS, "NX");
  if (claimed !== "OK") {
    const existing = await redis.get(redisKey);
    if (existing) {
      const stored = JSON.parse(existing) as StoredEffect<TResult>;
      if (stored.status === "complete") return stored.result;
      if (stored.status === "unknown") {
        if (options.reconcile) {
          const reconciled = await options.reconcile();
          if (reconciled !== null) {
            const complete = JSON.stringify({ status: "complete", result: reconciled } satisfies StoredEffect<TResult>);
            const script = `if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end`;
            if (await redis.eval(script, 1, redisKey, existing, complete, String(EFFECT_TTL_SECONDS)) === 1) {
              return reconciled;
            }
            const canonical = await redis.get(redisKey);
            if (canonical) {
              const current = JSON.parse(canonical) as StoredEffect<TResult>;
              if (current.status === "complete") return current.result;
            }
            throw new Error("Effect ownership changed during reconciliation");
          }
        }
        throw new EffectOutcomeUnknownError(stored.error);
      }
    }
    throw new Error("EFFECT_IN_FLIGHT");
  }
  const pendingJson = JSON.stringify(pending);
  try {
    const result = await fn();
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end`;
    const complete = JSON.stringify({ status: "complete", result } satisfies StoredEffect<TResult>);
    if (await redis.eval(script, 1, redisKey, pendingJson, complete, String(EFFECT_TTL_SECONDS)) !== 1) {
      throw new Error("Effect ownership was lost before completion");
    }
    return result;
  } catch (error) {
    if (isUnknownOutcome(error)) {
      const unknown = JSON.stringify({ status: "unknown", attemptedAt, error: errorMessage(error) } satisfies StoredEffect<TResult>);
      const script = `if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end`;
      await redis.eval(script, 1, redisKey, pendingJson, unknown, String(EFFECT_TTL_SECONDS));
    } else {
      const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
      await redis.eval(script, 1, redisKey, pendingJson);
    }
    throw error;
  }
}
