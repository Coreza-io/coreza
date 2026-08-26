import { effectKey, stableStringify } from "../src/engine/idempotency/effectGuard";

describe("effect guard parameter keying", () => {
  it("is stable across object key order and distinct across parameters and invocations", () => {
    expect(stableStringify({ b: { d: 2, c: 1 }, a: [2, 1] }))
      .toBe(stableStringify({ a: [2, 1], b: { c: 1, d: 2 } }));
    const base = { scopeId: "emission", nodeId: "node", operation: "send" };
    const first = effectKey({ ...base, params: { recipient: "a" } });
    const replay = effectKey({ ...base, params: { recipient: "a" } });
    const recipient = effectKey({ ...base, params: { recipient: "b" } });
    const repeated = effectKey({ ...base, params: { recipient: "a" }, invocationIndex: 1 });
    expect(first).toBe(replay);
    expect(new Set([first, recipient, repeated])).toHaveSize(3);
  });
});
