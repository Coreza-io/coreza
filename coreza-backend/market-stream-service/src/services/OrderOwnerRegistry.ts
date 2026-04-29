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
  brokerOrderId?: string;
  clientAlgoId?: string;
  algoId?: string;
}

export class OrderOwnerRegistry {
  static key(source: string, idType: keyof OrderOwnerIds, id: string): string {
    return `${PREFIX}:${source}:${idType}:${id}`;
  }

  static async findOwner(source: string, ids: OrderOwnerIds): Promise<OrderOwner | null> {
    const redis = getRedisQueue();
    const keys = (["clientOrderId", "brokerOrderId", "clientAlgoId", "algoId"] as const)
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
    brokerOrderId?: string;
    clientAlgoId?: string;
    algoId?: string;
    rawOrderData?: Record<string, any>;
  }): OrderOwnerIds {
    const raw = event.rawOrderData ?? {};
    const nested = raw.o ?? {};
    return {
      clientOrderId:
        event.clientOrderId ??
        raw.client_order_id ??
        raw.c ??
        nested.c ??
        raw.clientOrderId,
      brokerOrderId:
        event.brokerOrderId ??
        event.orderId ??
        raw.id ??
        raw.i ??
        nested.i ??
        raw.orderId,
      clientAlgoId:
        event.clientAlgoId ?? raw.caid ?? nested.caid ?? raw.clientAlgoId,
      algoId: event.algoId ?? raw.aid ?? nested.aid ?? raw.algoId,
    };
  }
}
