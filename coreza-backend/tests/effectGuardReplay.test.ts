const values = new Map<string, string>();
const redis = {
  set: jest.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    if (args.includes("NX") && values.has(key)) return null;
    values.set(key, value);
    return "OK";
  }),
  get: jest.fn(async (key: string) => values.get(key) ?? null),
  eval: jest.fn(async (script: string, keyCount: number, ...args: string[]) => {
    const key = args[0];
    const argv = args.slice(keyCount);
    if (values.get(key) !== argv[0]) return 0;
    if (script.includes("redis.call('set'")) values.set(key, argv[1]);
    else values.delete(key);
    return 1;
  }),
};

jest.mock("../src/config/redis", () => ({ getRedisCache: () => redis }));

import { runOnce } from "../src/engine/idempotency/effectGuard";

describe("effect guard replay", () => {
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
  });

  it("returns the cached result without repeating an external mutation", async () => {
    const mutate = jest.fn(async () => ({ messageId: "message-1" }));
    const scope = { userId: "user", workflowId: "workflow", executionId: "execution" };

    await expect(runOnce(scope, "emission:node:telegram:send", mutate))
      .resolves.toEqual({ messageId: "message-1" });
    await expect(runOnce(scope, "emission:node:telegram:send", mutate))
      .resolves.toEqual({ messageId: "message-1" });

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("releases ownership when the mutation fails", async () => {
    const mutate = jest.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ ok: true });
    const scope = { userId: "user", workflowId: "workflow", executionId: "execution" };

    await expect(runOnce(scope, "emission:node:store:set", mutate)).rejects.toThrow("temporary");
    await expect(runOnce(scope, "emission:node:store:set", mutate)).resolves.toEqual({ ok: true });
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
