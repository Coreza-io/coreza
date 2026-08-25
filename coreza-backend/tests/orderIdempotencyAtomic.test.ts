const values = new Map<string, string>();
const redis = {
  get: jest.fn(async (key: string) => values.get(key) ?? null),
  set: jest.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    if (args.includes("NX") && values.has(key)) return null;
    values.set(key, value);
    return "OK";
  }),
  eval: jest.fn(),
};

jest.mock("../src/config/redis", () => ({ getRedisCache: () => redis }));

import { claimOrderIntent } from "../src/utils/orderIdempotency";

describe("atomic order intent claims", () => {
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
  });

  it("allows exactly one of 20 concurrent identical claims", async () => {
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      claimOrderIntent("user", "workflow", "idempotency-key", "alpaca", `worker-${index}`)));

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(19);
    expect(redis.set.mock.calls.filter(([, , ...args]) => args.includes("NX"))).toHaveLength(20);
  });
});
