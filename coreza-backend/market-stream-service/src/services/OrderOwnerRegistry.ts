import { getRedisQueue } from "../config/redis";

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

  static async findOwner(
    source: string,
    ids: OrderOwnerIds,
  ): Promise<OrderOwner | null> {
    const redis = getRedisQueue();
    const keys = (
      ["clientOrderId", "orderId", "clientAlgoId", "algoId"] as const
    )
      .map((k) => [k, String(ids[k] || "").trim()] as const)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => this.key(source, k, v));
    if (keys.length === 0) return null;
    const result = await redis.mget(...keys);
    const first = result.find(Boolean);
    return first ? (JSON.parse(first) as OrderOwner) : null;
  }

  static deriveCandidateIds(event: {
    clientOrderId?: string;
    orderId?: string;
    clientAlgoId?: string;
    algoId?: string;
    rawOrderData?: Record<string, any>;
  }): OrderOwnerIds {
    return {
      clientOrderId: event.clientOrderId,
      orderId: event.orderId,
      clientAlgoId: event.clientAlgoId,
      algoId: event.algoId,
    };
  }
}
