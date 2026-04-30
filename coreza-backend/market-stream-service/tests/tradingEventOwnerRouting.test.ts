export {};
const { MarketDataSubscriber } = require("../src/services/MarketDataSubscriber");
const { OrderOwnerRegistry } = require("../src/services/OrderOwnerRegistry");

const onHandlers: Record<string, any> = {};

jest.mock("../src/config/redis", () => ({
  createRedisPubSub: () => ({
    pub: {
      keys: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    },
    sub: {
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event, cb) => {
        onHandlers[event] = cb;
      }),
      off: jest.fn(),
    },
  }),
  getRedisCache: () => ({ keys: jest.fn().mockResolvedValue([]) }),
}));

describe("trading event owner routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes alpaca trade_updates only to owner workflow", async () => {
    const subscriber = MarketDataSubscriber.getInstance();
    jest.spyOn(subscriber, "persistRegistration").mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(subscriber, "enqueueWorkflowDelivery").mockImplementation(() => undefined);

    await subscriber.registerWorkflow("wf-owner", "n1", "u1", [], "alpaca_trading", "live", true, true, ["AAPL"], "exact", ["trade_updates"]);
    await subscriber.registerWorkflow("wf-other", "n2", "u1", [], "alpaca_trading", "live", true, true, ["AAPL"], "exact", ["trade_updates"]);

    jest.spyOn(OrderOwnerRegistry, "findOwner").mockResolvedValue({ workflowId: "wf-owner" });

    await onHandlers.message("md:symbol:trade_updates", JSON.stringify({ source: "alpaca", symbol: "AAPL", type: "order_update" }));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0]).toBe("wf-owner");
  });

  it("resolves binance ORDER_TRADE_UPDATE via nested o.i", async () => {
    const ids = OrderOwnerRegistry.deriveCandidateIds({ rawOrderData: { o: { i: 12345 } } });
    expect(ids.brokerOrderId).toBe(12345);
  });

  it("resolves binance ALGO_UPDATE via caid/aid", async () => {
    const ids = OrderOwnerRegistry.deriveCandidateIds({ rawOrderData: { o: { caid: "ca-1", aid: "a-1" } } });
    expect(ids.clientAlgoId).toBe("ca-1");
    expect(ids.algoId).toBe("a-1");
  });

  it("drops no-owner event", async () => {
    const subscriber = MarketDataSubscriber.getInstance();
    jest.spyOn(subscriber, "persistRegistration").mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(subscriber, "enqueueWorkflowDelivery").mockImplementation(() => undefined);
    jest.spyOn(OrderOwnerRegistry, "findOwner").mockResolvedValue(null);

    await subscriber.registerWorkflow("wf-owner2", "n1", "u1", [], "binance_trading", "live", true, true, ["BTCUSDT"], "exact", ["ORDER_TRADE_UPDATE"]);
    await onHandlers.message("md:symbol:ORDER_TRADE_UPDATE", JSON.stringify({ source: "binance", symbol: "BTCUSDT", type: "order_update", rawOrderData: { e: "ORDER_TRADE_UPDATE", o: { i: 10 } } }));

    expect(enqueueSpy).toHaveBeenCalledTimes(0);
  });

  it("fans out listen_key_expired to all workflows on same account source", async () => {
    const subscriber = MarketDataSubscriber.getInstance();
    jest.spyOn(subscriber, "persistRegistration").mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(subscriber, "enqueueWorkflowDelivery").mockImplementation(() => undefined);

    await subscriber.registerWorkflow("wf-a", "n1", "u1", [], "binance_trading", "live", true, true, [], "exact", ["listenKeyExpired"]);
    await subscriber.registerWorkflow("wf-b", "n2", "u1", [], "binance_trading", "live", true, true, [], "exact", ["listenKeyExpired"]);

    await onHandlers.message("md:symbol:listenKeyExpired", JSON.stringify({ source: "binance", symbol: "BTCUSDT", type: "listen_key_expired" }));

    const targeted = enqueueSpy.mock.calls.map((c: any[]) => c[0]);
    expect(targeted).toContain("wf-a");
    expect(targeted).toContain("wf-b");
  });
});
