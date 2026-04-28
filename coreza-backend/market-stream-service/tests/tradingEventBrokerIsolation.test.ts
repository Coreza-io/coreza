const {
  MarketControlHandler,
} = require("../src/services/MarketControlHandler");

const mockSadd = jest.fn();

jest.mock("../src/config/redis", () => ({
  createRedisPubSub: () => ({
    pub: {
      sadd: mockSadd,
      srem: jest.fn(),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      publish: jest.fn(),
      quit: jest.fn(),
      subscribe: jest.fn(),
    },
    sub: {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      quit: jest.fn(),
    },
  }),
}));

describe("trading subscription stream isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores alpaca trading stream as account-level native stream", async () => {
    const handler = MarketControlHandler.getInstance();

    const state = {
      streams: new Set(),
      workflowStreams: new Map(),
      gateway: { getStats: () => ({ connected: true }), subscribeStreams: jest.fn() },
    };

    jest
      .spyOn(handler, "connectGateway")
      .mockImplementation(async () => undefined);
    handler.sourceStates.set("user-1:alpaca_trading", state);
    jest.spyOn(handler, "updateActiveStreamingWorkflows").mockResolvedValue(undefined);
    jest.spyOn(handler, "persistState").mockResolvedValue(undefined);

    await handler.handleSubscribe({
      action: "subscribe",
      source: "alpaca_trading",
      userId: "user-1",
      workflowId: "wf-1",
      symbols: ["AAPL", "MSFT", "TSLA"],
      streamType: ["order_update"],
      environment: "paper",
      marketType: "spot",
      scope: "workflow",
      targetWorkflowId: "wf-1",
    });

    expect(mockSadd).toHaveBeenCalledWith(
      "md:user:user-1:subscription:scope:workflow:wf-1:alpaca_trading:paper:streams",
      "trade_updates",
    );
  });

  it("stores binance futures trading native stream set", async () => {
    const handler = MarketControlHandler.getInstance();

    const state = {
      streams: new Set(),
      workflowStreams: new Map(),
      gateway: { getStats: () => ({ connected: true }), subscribeStreams: jest.fn() },
    };

    handler.sourceStates.set("user-1:binance_trading", state);
    jest.spyOn(handler, "updateActiveStreamingWorkflows").mockResolvedValue(undefined);
    jest.spyOn(handler, "persistState").mockResolvedValue(undefined);

    await handler.handleSubscribe({
      action: "subscribe",
      source: "binance_trading",
      userId: "user-1",
      workflowId: "wf-2",
      symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      streamType: ["order_update"],
      environment: "live",
      marketType: "futures",
      scope: "workflow",
      targetWorkflowId: "wf-2",
    });

    expect(mockSadd).toHaveBeenCalledWith(
      "md:user:user-1:subscription:scope:workflow:wf-2:binance_trading:live:streams",
      "ORDER_TRADE_UPDATE",
      "ALGO_UPDATE",
      "ACCOUNT_UPDATE",
      "ACCOUNT_CONFIG_UPDATE",
      "MARGIN_CALL",
      "listenKeyExpired",
    );
  });
});
