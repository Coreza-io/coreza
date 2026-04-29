const { extendOrderOwner, saveOrderOwner } = require("../src/services/orderOwnership");

describe("orderOwnership persistence", () => {
  it("writes owner keys with ttl and extends using broker ids", async () => {
    const store = new Map();
    const redis = {
      set: jest.fn(async (key, value) => {
        store.set(key, value);
        return "OK";
      }),
      get: jest.fn(async (key) => store.get(key) ?? null),
    };

    const owner = {
      userId: "u1",
      workflowId: "wf1",
      nodeId: "n1",
      runId: "r1",
      source: "alpaca_trading",
      symbol: "AAPL",
      createdAt: new Date().toISOString(),
    };

    await saveOrderOwner(redis, "alpaca_trading", owner, { clientOrderId: "cid-1" }, 1234);
    await extendOrderOwner(redis, "alpaca_trading", {
      clientOrderId: "cid-1",
      brokerOrderId: "bo-1",
    });

    expect(store.has("order_owner:alpaca_trading:clientOrderId:cid-1")).toBe(true);
    expect(store.has("order_owner:alpaca_trading:brokerOrderId:bo-1")).toBe(true);
  });
});
