import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { getRedisCache } from "../../config/redis";
import logger from "../../utils/logger";

export const BACKTEST_SESSION_SCOPE = "backtest_session";
export const BACKTEST_STORE_MAX_TTL = 24 * 60 * 60;
export const BACKTEST_STORE_SESSION_REQUIRED =
  "Backtest session storage requires a matching backtest. Run BacktestInit in this workflow and editor session first. If multiple backtests are active, select a Backtest ID.";

export const backtestStoreOperations = new Set([
  "set", "get", "delete", "increment", "append",
  "lpush", "rpush", "rpush_bounded", "lpop", "rpop", "lrange", "llen", "lindex", "lset", "ltrim",
]);

export class BacktestSessionStore {
  private readonly prefix: string;
  private readonly pending = new Set<Promise<unknown>>();
  private redis?: Redis;
  private closed = false;

  constructor(readonly userId: string, readonly workflowId: string) {
    const owner = Buffer.from(userId).toString("base64url");
    const workflow = Buffer.from(workflowId).toString("base64url");
    this.prefix = `backtest-store:v1:${owner}:${workflow}:${randomUUID()}:`;
  }

  key(variableName: string): string {
    return this.prefix + variableName;
  }

  async execute<T>(operation: (redis: Redis) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error(BACKTEST_STORE_SESSION_REQUIRED);
    const redis = this.redis ??= getRedisCache();
    const pending = operation(redis);
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const redis = this.redis;
    if (!redis) return;

    // Drain admitted operations before deleting keys. New operations fail as soon as closing starts.
    void Promise.allSettled(this.pending).then(async () => {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${this.prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length) await redis.unlink(...keys);
      } while (cursor !== "0");
    }).catch(error => logger.warn({ err: error }, "Failed to clean up backtest session storage"));
  }
}
