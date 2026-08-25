const values = new Map<string, string>();
const redis = {
  mget: jest.fn(async (...keys: string[]) => keys.map((key) => values.get(key) ?? null)),
  set: jest.fn(async (key: string, value: string) => {
    if (values.has(key)) return null;
    values.set(key, value);
    return "OK";
  }),
};

jest.mock("../src/config/redis", () => ({ getRedisCache: () => redis }));

import {
  findDeliveredEmissionIds,
  recordDeliveredEmissions,
} from "../src/engine/consolidation/consolidatorDeliveryReceipt";

describe("consolidator delivery receipts", () => {
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
  });

  it("persists and detects a delivered emission for replay draining", async () => {
    expect(await findDeliveredEmissionIds("user", "execution", ["emission-1"])).toEqual(new Set());

    await recordDeliveredEmissions("user", "execution", ["emission-1"]);

    expect(await findDeliveredEmissionIds("user", "execution", ["emission-1", "emission-2"]))
      .toEqual(new Set(["emission-1"]));
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("execution:execution:emission-1"),
      expect.any(String),
      "EX",
      604800,
      "NX",
    );
  });
});
