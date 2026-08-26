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

import { effectKey, runOnce, stableStringify } from "../src/engine/idempotency/effectGuard";

describe("effect guard parameter keying", () => {
  beforeEach(() => values.clear());

  it("executes distinct recipients and loop invocations while replaying an identical key", async () => {
    expect(stableStringify({ b: { d: 2, c: 1 }, a: [2, 1] }))
      .toBe(stableStringify({ a: [2, 1], b: { c: 1, d: 2 } }));
    const scope = { userId: "user", workflowId: "workflow", executionId: "execution" };
    const send = jest.fn(async (recipient: string) => ({ recipient }));
    const key = (recipient: string, invocationIndex?: number) => effectKey({
      scopeId: "emission",
      nodeId: "send-node",
      operation: "telegram:send",
      params: { recipient, body: "same message" },
      invocationIndex,
    });

    await runOnce(scope, key("alice"), () => send("alice"));
    await runOnce(scope, key("bob"), () => send("bob"));
    await runOnce(scope, key("alice", 1), () => send("alice"));
    await runOnce(scope, key("alice"), () => send("alice"));

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls).toEqual([["alice"], ["bob"], ["alice"]]);
  });

  it("serializes dates and non-finite numeric values deterministically", () => {
    expect(stableStringify({ at: new Date("2026-01-01T00:00:00Z"), value: Number.NaN }))
      .toBe('{"at":"2026-01-01T00:00:00.000Z","value":"NaN"}');
  });
});
