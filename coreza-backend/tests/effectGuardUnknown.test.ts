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

describe("effect guard unknown outcomes", () => {
  beforeEach(() => values.clear());

  it("persists timeouts and prevents a blind retry", async () => {
    const timeout = Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
    const mutate = jest.fn().mockRejectedValue(timeout);
    const scope = { userId: "u", workflowId: "w", executionId: "e" };
    await expect(runOnce(scope, "key", mutate)).rejects.toBe(timeout);
    await expect(runOnce(scope, "key", mutate)).rejects.toMatchObject({ code: "EFFECT_OUTCOME_UNKNOWN" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect([...values.values()][0]).toContain('"status":"unknown"');
  });
});
