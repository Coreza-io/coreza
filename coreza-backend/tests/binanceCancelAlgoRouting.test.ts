jest.mock("../src/utils/binanceTimeSync", () => ({
  getBinanceTimestamp: () => 1700000000000,
}));

const { binanceOperations } = require("../src/brokers/binance/http/operations");
const {
  StreamingLifecycleAdapter,
} = require("../src/workflow/StreamingLifecycleAdapter");
const { SubscriptionService } = require("../src/services/SubscriptionService");

describe("binance cancel routing", () => {
  const creds = { secret_key: "test-secret" };

  it("routes futures algo cancel to /fapi/v1/algoOrder with algoId", () => {
    const path = binanceOperations.cancel_order.path?.({
      marketType: "futures",
      algoId: "99901",
    });

    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        algoId: "99901",
      },
      creds,
    );

    expect(path).toBe("/fapi/v1/algoOrder");
    expect(params?.algoId).toBe("99901");
    expect(params?.orderId).toBeUndefined();
  });

  it("routes standard cancel to /fapi/v1/order with orderId", () => {
    const path = binanceOperations.cancel_order.path?.({
      marketType: "futures",
      orderId: "12345",
    });

    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        orderId: "12345",
      },
      creds,
    );

    expect(path).toBe("/fapi/v1/order");
    expect(params?.orderId).toBe("12345");
    expect(params?.algoId).toBeUndefined();
  });

  it("routes spot cancel to /api/v3/order and uses origClientOrderId for non-numeric identity", () => {
    const path = binanceOperations.cancel_order.path?.({
      marketType: "spot",
    });

    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "spot",
        symbol: "BTCUSDT",
        origClientOrderId: "my-client-1",
      },
      creds,
    );

    expect(path).toBe("/api/v3/order");
    expect(params?.origClientOrderId).toBe("my-client-1");
    expect(params?.orderId).toBeUndefined();
  });

  it("uses clientAlgoId when provided for algo cancel", () => {
    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        clientAlgoId: "algo-client-1",
      },
      creds,
    );

    expect(params?.clientAlgoId).toBe("algo-client-1");
    expect(params?.algoId).toBeUndefined();
    expect(params?.symbol).toBeUndefined();
  });

  it("uses origClientOrderId for normal cancel", () => {
    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        origClientOrderId: "normal-client-1",
      },
      creds,
    );

    expect(params?.origClientOrderId).toBe("normal-client-1");
    expect(params?.orderId).toBeUndefined();
  });

  it("supports legacy algo_id fallback for backwards compatibility", () => {
    const path = binanceOperations.cancel_order.path?.({
      marketType: "futures",
      algo_id: "777",
    });
    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        algo_id: "777",
      },
      creds,
    );

    expect(path).toBe("/fapi/v1/algoOrder");
    expect(params?.algoId).toBe("777");
  });

  it("requires symbol for normal cancel but not for algo cancel", () => {
    expect(() =>
      binanceOperations.cancel_order.makeParams?.(
        {
          marketType: "futures",
          orderId: "123",
        },
        creds,
      ),
    ).toThrow("symbol is required for cancel_order");

    expect(() =>
      binanceOperations.cancel_order.makeParams?.(
        {
          marketType: "futures",
          algoId: "123",
        },
        creds,
      ),
    ).not.toThrow();
  });
});

describe("streaming lifecycle trading unsubscribe routing", () => {
  it("releases trading workflow claim without per-symbol payload", async () => {
    const unsubscribeSpy = jest
      .spyOn(SubscriptionService, "unsubscribe")
      .mockResolvedValue({ success: true, data: undefined });

    const adapter = new StreamingLifecycleAdapter();
    await adapter.unsubscribeStreamingNodes("user-1", "wf-1", [
      {
        id: "node-1",
        subCategory: "binance",
        values: {
          symbols: ["BTCUSDT", "ETHUSDT"],
          stream_type: ["kline", "order_update"],
          environment: "live",
          marketType: "futures",
          scope: "workflow",
        },
      },
    ]);

    const tradingCall = unsubscribeSpy.mock.calls.find(
      ([params]) => params.source === "binance_trading",
    )?.[0];
    expect(tradingCall).toBeDefined();
    expect(tradingCall.symbols).toEqual([]);
    expect(tradingCall.streamType).toEqual(["order_update"]);
  });
});
