import { MarketDataSubscriber } from "../src/services/MarketDataSubscriber";
import { redisSetBreaker } from "../src/utils/redisCircuitBreaker";

describe("registerWorkflow native trading streams", () => {
  it("registers all supplied native trading streams in streamWorkflows", async () => {
    const subscriber = MarketDataSubscriber.getInstance() as any;

    jest
      .spyOn(subscriber, "ensureRedisConnections")
      .mockReturnValue({
        sub: {
          subscribe: jest.fn().mockResolvedValue(undefined),
          unsubscribe: jest.fn().mockResolvedValue(undefined),
          on: jest.fn(),
          off: jest.fn(),
        },
        pub: {
          del: jest.fn().mockResolvedValue(undefined),
        },
      });
    jest
      .spyOn(subscriber, "persistRegistration")
      .mockResolvedValue(undefined);
    jest.spyOn(subscriber, "setupMessageHandler").mockImplementation(() => {});

    await subscriber.registerWorkflow(
      "wf-native",
      "node-1",
      "user-1",
      [],
      "binance_trading",
      "live",
      true,
      true,
      ["BTCUSDT"],
      "exact",
      ["ORDER_TRADE_UPDATE", "ALGO_UPDATE", "ACCOUNT_UPDATE"],
    );

    expect(subscriber.streamWorkflows.get("ORDER_TRADE_UPDATE")).toBeDefined();
    expect(subscriber.streamWorkflows.get("ALGO_UPDATE")).toBeDefined();
    expect(subscriber.streamWorkflows.get("ACCOUNT_UPDATE")).toBeDefined();
    expect(subscriber.streamWorkflows.get("ORDER_TRADE_UPDATE").has("wf-native")).toBe(
      true,
    );
  });

  it("persists tradingNativeStreams from dedicated registration state", async () => {
    jest.restoreAllMocks();
    const subscriber = MarketDataSubscriber.getInstance() as any;
    const setSpy = jest
      .spyOn(redisSetBreaker, "fire")
      .mockResolvedValue("OK" as never);

    await subscriber.persistRegistration({
      workflowId: "wf-native-persist",
      nodeId: "node-2",
      userId: "user-1",
      streams: new Set(["bars.AAPL", "trade_updates"]),
      tradingNativeStreams: new Set(["trade_updates"]),
      source: "alpaca_trading",
      environment: "paper",
      allowedSymbols: new Set(["AAPL"]),
      symbolMatchMode: "exact",
      onlyClosedBars: true,
      isLive: true,
    });

    const payload = JSON.parse(setSpy.mock.calls[0][1] as string);
    expect(payload.tradingNativeStreams).toEqual(["trade_updates"]);
    expect(payload.tradingNativeStreams).not.toContain("bars.AAPL");
  });
});
