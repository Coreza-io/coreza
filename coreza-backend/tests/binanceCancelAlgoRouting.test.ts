jest.mock("../src/utils/binanceTimeSync", () => ({
  getBinanceTimestamp: () => 1700000000000,
}));

const { binanceOperations } = require("../src/brokers/binance/http/operations");

describe("binance cancel routing", () => {
  const creds = { secret_key: "test-secret" };

  it("routes futures algo cancel to /fapi/v1/algoOrder with algoId", () => {
    const path = binanceOperations.cancel_order.path?.({
      marketType: "futures",
      isAlgo: true,
    });

    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        isAlgo: true,
        algo_id: "99901",
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
      orderType: "LIMIT",
    });

    const params = binanceOperations.cancel_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        orderType: "LIMIT",
        order_id: "12345",
      },
      creds,
    );

    expect(path).toBe("/fapi/v1/order");
    expect(params?.orderId).toBe("12345");
    expect(params?.algoId).toBeUndefined();
  });
});
