import { storeConfig } from "../src/services/storage/configs/store";
import { StorageService } from "../src/services/storage/storageService";
import { getRedisCache } from "../src/config/redis";
import type {
  StorageContext,
  StorageInput,
} from "../src/services/storage/types";

jest.mock("../src/config/redis", () => ({
  getRedisCache: jest.fn(),
}));
jest.mock("../src/utils/credentialManager", () => ({
  __esModule: true,
  default: { getCredentials: jest.fn() },
}));

const input = (ttl?: unknown): StorageInput =>
  ({
    operation: "rpush",
    user_id: "user-1",
    workflow_id: "workflow-1",
    variableName: "orders",
    value: { id: 1 },
    ttl,
  }) as StorageInput;

const setup = () => {
  const redis = {
    rpush: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
  const context = { userId: "user-1", redis } as unknown as StorageContext;
  const handler = storeConfig.operations.rpush.handler;
  return { redis, context, handler };
};

describe("Store rpush TTL", () => {
  it.each([undefined, "", "invalid", 0, -1, 1.5])(
    "does not expire an invalid TTL (%p)",
    async (ttl) => {
      const { redis, context, handler } = setup();
      await handler(input(ttl), context);
      expect(redis.expire).not.toHaveBeenCalled();
    },
  );

  it("coerces and applies a valid TTL", async () => {
    const { redis, context, handler } = setup();
    await handler(input("60"), context);
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 60);
  });

  it("succeeds when expiry fails after rpush", async () => {
    const { redis, context, handler } = setup();
    redis.expire.mockRejectedValueOnce(new Error("expiry unavailable"));
    await expect(handler(input(60), context)).resolves.toMatchObject({
      operation: "rpush",
    });
  });

  it.each([new Error("write unavailable"), ""])(
    "returns a non-empty node error when rpush rejects with %p",
    async (failure) => {
      const { redis } = setup();
      redis.rpush.mockRejectedValueOnce(failure);
      jest.mocked(getRedisCache).mockReturnValue(redis as never);

      const result = await new StorageService("store", storeConfig).execute(
        input(60),
      );

      expect(result.success).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      expect(result.error).not.toHaveLength(0);
    },
  );
});
