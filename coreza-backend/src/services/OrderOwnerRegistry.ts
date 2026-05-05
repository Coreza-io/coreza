import { getRedisQueue } from "../config/redis";

const TTL_SECONDS = 86400;
const PREFIX = "order_owner";

export interface OrderOwner {
  userId: string;
  workflowId: string;
  nodeId: string;
  runId?: string;
  source: string;
  symbol?: string;
  createdAt: string;
}

export interface OrderOwnerIds {
  clientOrderId?: string;
  orderId?: string;
  clientAlgoId?: string;
  algoId?: string;
}

export class OrderOwnerRegistry {
  static key(source: string, idType: keyof OrderOwnerIds, id: string): string {
    return `${PREFIX}:${source}:${idType}:${id}`;
  }

  static async saveOwner(input: OrderOwner & OrderOwnerIds): Promise<void> {
    const redis = getRedisQueue();
    const owner: OrderOwner = {
      userId: input.userId,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      runId: input.runId,
      source: input.source,
      symbol: input.symbol,
      createdAt: input.createdAt || new Date().toISOString(),
    };
    const payload = JSON.stringify(owner);
    const ids: OrderOwnerIds = {
      clientOrderId: input.clientOrderId,
      orderId: input.orderId,
      clientAlgoId: input.clientAlgoId,
      algoId: input.algoId,
    };
    await Promise.all(
      (Object.keys(ids) as Array<keyof OrderOwnerIds>)
        .filter((k) => String(ids[k] || "").trim())
        .map((k) =>
          redis.set(
            this.key(input.source, k, String(ids[k]).trim()),
            payload,
            "EX",
            TTL_SECONDS,
          ),
        ),
    );
  }

  static async deleteOwnerIds(
    source: string,
    ids: OrderOwnerIds,
  ): Promise<number> {
    const redis = getRedisQueue();
    const keys = (
      ["clientOrderId", "orderId", "clientAlgoId", "algoId"] as const
    )
      .map((k) => [k, String(ids[k] || "").trim()] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => this.key(source, k, v));
    if (keys.length === 0) return 0;
    return redis.del(...keys);
  }

  static async findOwner(
    source: string,
    ids: OrderOwnerIds,
  ): Promise<OrderOwner | null> {
    const redis = getRedisQueue();
    const keys = (
      ["clientOrderId", "orderId", "clientAlgoId", "algoId"] as const
    )
      .map((k) => [k, String(ids[k] || "").trim()] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => this.key(source, k, v));
    if (keys.length === 0) return null;
    const hits = await redis.mget(...keys);
    const first = hits.find(Boolean);
    return first ? (JSON.parse(first) as OrderOwner) : null;
  }

  static async cleanupByWorkflow(workflowId: string): Promise<number> {
    const redis = getRedisQueue();
    let cursor = "0";
    let cleaned = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${PREFIX}:*`,
        "COUNT",
        200,
      );
      cursor = nextCursor;

      if (keys.length === 0) {
        continue;
      }

      const values = await redis.mget(...keys);
      const keysToDelete = keys.filter((key, index) => {
        const value = values[index];
        if (!value) {
          return false;
        }

        try {
          const owner = JSON.parse(value) as OrderOwner;
          return owner.workflowId === workflowId;
        } catch {
          return false;
        }
      });

      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
        cleaned += keysToDelete.length;
      }
    } while (cursor !== "0");

    return cleaned;
  }
}
