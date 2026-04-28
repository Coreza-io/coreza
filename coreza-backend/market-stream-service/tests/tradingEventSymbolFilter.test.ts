const { MarketDataSubscriber } = require("../src/services/MarketDataSubscriber");

const onHandlers = {};

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
  getRedisCache: () => ({
    keys: jest.fn().mockResolvedValue([]),
  }),
}));

describe("trading symbol filter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("drops unmatched symbols and allows newly added symbols", async () => {
    const subscriber = MarketDataSubscriber.getInstance();
    jest.spyOn(subscriber, "persistRegistration").mockResolvedValue(undefined);

    const enqueueSpy = jest
      .spyOn(subscriber, "enqueueWorkflowDelivery")
      .mockImplementation(() => undefined);

    await subscriber.registerWorkflow(
      "wf-filter",
      "node-1",
      "user-1",
      [],
      "binance_trading",
      "live",
      true,
      true,
      ["BTCUSDT"],
      "exact",
      ["ORDER_TRADE_UPDATE"],
    );

    const messageHandler = onHandlers.message;
    expect(typeof messageHandler).toBe("function");

    const ethEvent = {
      source: "binance",
      symbol: "ETHUSDT",
      type: "order_update",
      rawOrderData: { e: "ORDER_TRADE_UPDATE" },
    };

    await messageHandler("md:symbol:ORDER_TRADE_UPDATE", JSON.stringify(ethEvent));
    expect(enqueueSpy).toHaveBeenCalledTimes(0);

    await subscriber.addAllowedSymbolsToRegistration("wf-filter", ["ETHUSDT"]);
    await messageHandler("md:symbol:ORDER_TRADE_UPDATE", JSON.stringify(ethEvent));
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });
});
