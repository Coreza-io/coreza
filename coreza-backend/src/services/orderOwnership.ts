import Redis from "ioredis";

export interface OrderOwner {
  userId: string;
  workflowId: string;
  nodeId: string;
  runId: string;
  source: string;
  symbol: string;
  createdAt: string;
}

type OrderOwnerIds = {
  clientOrderId?: string;
  orderId?: string;
  clientAlgoId?: string;
  algoId?: string;
};

const ORDER_OWNER_PREFIX = "orderowner";

export function orderOwnerKey(
  source: string,
  idType: keyof OrderOwnerIds,
  idValue: string,
): string {
  return `${ORDER_OWNER_PREFIX}:${source}:${idType}:${idValue}`;
}

export async function saveOrderOwner(
  redis: Redis,
  source: string,
  owner: OrderOwner,
  ids: OrderOwnerIds,
  ttlSeconds = 86400,
): Promise<void> {
  const payload = JSON.stringify(owner);
  const writes: Promise<unknown>[] = [];

  (Object.keys(ids) as Array<keyof OrderOwnerIds>).forEach((idType) => {
    const raw = ids[idType];
    const idValue = String(raw ?? "").trim();
    if (!idValue) return;
    writes.push(
      redis.set(
        orderOwnerKey(source, idType, idValue),
        payload,
        "EX",
        ttlSeconds,
      ),
    );
  });

  await Promise.all(writes);
}

export async function extendOrderOwner(
  redis: Redis,
  source: string,
  ids: OrderOwnerIds,
  ttlSeconds = 86400,
): Promise<void> {
  const allIds = Object.entries(ids).filter(([, value]) =>
    String(value || "").trim(),
  );
  if (allIds.length < 2) return;

  let ownerPayload: string | null = null;
  for (const [idType, idValue] of allIds) {
    const existing = await redis.get(
      orderOwnerKey(source, idType as keyof OrderOwnerIds, String(idValue)),
    );
    if (existing) {
      ownerPayload = existing;
      break;
    }
  }
  if (!ownerPayload) return;

  await Promise.all(
    allIds.map(([idType, idValue]) =>
      redis.set(
        orderOwnerKey(source, idType as keyof OrderOwnerIds, String(idValue)),
        ownerPayload as string,
        "EX",
        ttlSeconds,
      ),
    ),
  );
}
