import { storeConfig } from "../src/services/storage/configs/store";
import { getRedisCache } from "../src/config/redis";
import { StorageService } from "../src/services/storage/storageService";
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

type TransactionReply = [Error | null, unknown];

const input = (
  overrides: Partial<Omit<StorageInput, "ttl">> & { ttl?: unknown } = {},
): StorageInput =>
  ({
    operation: "rpush_bounded",
    user_id: "user-1",
    workflow_id: "workflow-1",
    variableName: "orders",
    value: { id: 1 },
    maxLength: 8,
    ...overrides,
  }) as StorageInput;

const setup = (
  replies: TransactionReply[] | null = [
    [null, 1],
    [null, "OK"],
    [null, 1],
  ],
) => {
  const transaction = {
    rpush: jest.fn(),
    ltrim: jest.fn(),
    llen: jest.fn(),
    exec: jest.fn().mockResolvedValue(replies),
  };
  transaction.rpush.mockReturnValue(transaction);
  transaction.ltrim.mockReturnValue(transaction);
  transaction.llen.mockReturnValue(transaction);

  const redis = {
    multi: jest.fn(() => transaction),
    expire: jest.fn().mockResolvedValue(1),
    type: jest.fn().mockResolvedValue("string"),
  };
  const context = { userId: "user-1", redis } as unknown as StorageContext;
  return {
    redis,
    transaction,
    context,
    handler: storeConfig.operations.rpush_bounded.handler,
  };
};

describe("Store rpush_bounded", () => {
  it("queues append, trim, and final length in one transaction", async () => {
    const { redis, transaction, context, handler } = setup([
      [null, 9],
      [null, "OK"],
      [null, 8],
    ]);

    const result = await handler(input(), context);
    const key = expect.any(String);

    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(transaction.rpush).toHaveBeenCalledWith(key, '{"id":1}');
    expect(transaction.ltrim).toHaveBeenCalledWith(key, -8, -1);
    expect(transaction.llen).toHaveBeenCalledWith(key);
    expect(transaction.rpush.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.ltrim.mock.invocationCallOrder[0],
    );
    expect(transaction.ltrim.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.llen.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      operation: "rpush_bounded",
      variableName: "orders",
      maxLength: 8,
      length: 8,
    });
  });

  it("keeps the latest N values end to end", async () => {
    const values = ["1", "2", "3", "4", "5", "6", "7", "8"];
    let pendingValue = "";
    let pendingMaxLength = 0;
    const transaction: {
      rpush: jest.Mock;
      ltrim: jest.Mock;
      llen: jest.Mock;
      exec: jest.Mock;
    } = {
      rpush: jest.fn((_key: string, value: string) => {
        pendingValue = value;
        return transaction;
      }),
      ltrim: jest.fn((_key: string, start: number) => {
        pendingMaxLength = -start;
        return transaction;
      }),
      llen: jest.fn(() => transaction),
      exec: jest.fn(async (): Promise<TransactionReply[]> => {
        values.push(pendingValue);
        values.splice(0, Math.max(0, values.length - pendingMaxLength));
        return [
          [null, 9],
          [null, "OK"],
          [null, values.length],
        ];
      }),
    };
    const redis = {
      multi: jest.fn(() => transaction),
      expire: jest.fn(),
      type: jest.fn(),
    };
    const context = { userId: "user-1", redis } as unknown as StorageContext;

    const result = await storeConfig.operations.rpush_bounded.handler(
      input({ value: "9" }),
      context,
    );

    expect(values).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(result).toMatchObject({ length: 8 });
  });

  it.each([
    [{ id: 2 }, '{"id":2}'],
    ["already serialized", "already serialized"],
  ])("serializes %p consistently with rpush", async (value, serialized) => {
    const { transaction, context, handler } = setup();
    await handler(input({ value }), context);
    expect(transaction.rpush).toHaveBeenCalledWith(
      expect.any(String),
      serialized,
    );
  });

  it.each([0, -1, 1.5, "abc", undefined, 100001])(
    "rejects invalid maxLength %p before calling Redis",
    async (maxLength) => {
      const { redis, context, handler } = setup();
      await expect(handler(input({ maxLength }), context)).rejects.toThrow(
        "maxLength must be a positive integer no greater than 100000",
      );
      expect(redis.multi).not.toHaveBeenCalled();
    },
  );

  it("converts WRONGTYPE transaction replies to the actionable type error", async () => {
    const wrongType = new Error(
      "WRONGTYPE Operation against a key holding the wrong kind of value",
    );
    const { redis } = setup([
      [wrongType, null],
      [null, null],
      [null, null],
    ]);
    jest.mocked(getRedisCache).mockReturnValue(redis as never);

    const result = await new StorageService("store", storeConfig).execute(
      input(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /already holds a string; List operations require a list/,
    );
    expect(result.error).not.toContain("WRONGTYPE");
  });

  it("reports an aborted transaction clearly", async () => {
    const { context, handler } = setup(null);
    await expect(handler(input(), context)).rejects.toThrow(
      "Store transaction aborted; please retry",
    );
  });

  it.each([undefined, "", "invalid", 0, -1, 1.5])(
    "does not expire for invalid TTL %p",
    async (ttl) => {
      const { redis, context, handler } = setup();
      await handler(input({ ttl }), context);
      expect(redis.expire).not.toHaveBeenCalled();
    },
  );

  it("applies valid TTL after the transaction", async () => {
    const { redis, transaction, context, handler } = setup();
    await handler(input({ ttl: "60" }), context);
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 60);
    expect(transaction.exec.mock.invocationCallOrder[0]).toBeLessThan(
      redis.expire.mock.invocationCallOrder[0],
    );
  });

  it("still succeeds when best-effort expiry fails", async () => {
    const { redis, context, handler } = setup();
    redis.expire.mockRejectedValueOnce(new Error("expiry unavailable"));
    await expect(handler(input({ ttl: 60 }), context)).resolves.toMatchObject({
      operation: "rpush_bounded",
      length: 1,
    });
  });
});
