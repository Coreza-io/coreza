jest.mock("../src/utils/binanceTimeSync", () => ({
  getBinanceTimestamp: () => 1700000000000,
}));

import { binanceOperations } from "../src/brokers/binance/http/operations";

describe("binance futures order payload routing", () => {
  const creds = { secret_key: "test-secret" };

  it("routes conditional futures orders to algo endpoint", () => {
    const path = binanceOperations.place_order.path?.({
      marketType: "futures",
      type: "STOP_MARKET",
    });

    expect(path).toBe("/fapi/v1/algoOrder");
  });

  it("uses triggerPrice and algoType for STOP_MARKET", () => {
    const params = binanceOperations.place_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        stopPrice: "58000",
        quantity: "0.001",
      },
      creds,
    );

    expect(params?.algoType).toBe("CONDITIONAL");
    expect(params?.triggerPrice).toBe("58000");
    expect(params?.stopPrice).toBeUndefined();
    expect(params?.newOrderRespType).toBe("ACK");
  });

  it("maps activationPrice to activatePrice for trailing stop", () => {
    const params = binanceOperations.place_order.makeParams?.(
      {
        marketType: "futures",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "TRAILING_STOP_MARKET",
        quantity: "0.001",
        callbackRate: "0.5",
        activationPrice: "61000",
      },
      creds,
    );

    expect(params?.activatePrice).toBe("61000");
    expect(params?.activationPrice).toBeUndefined();
  });

  it("rejects closePosition + quantity", () => {
    expect(() =>
      binanceOperations.place_order.makeParams?.(
        {
          marketType: "futures",
          symbol: "BTCUSDT",
          side: "SELL",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: "62000",
          closePosition: true,
          quantity: "0.001",
        },
        creds,
      ),
    ).toThrow("quantity cannot be sent when closePosition=true");
  });

  it("rejects GTD when goodTillDate is too soon", () => {
    expect(() =>
      binanceOperations.place_order.makeParams?.(
        {
          marketType: "futures",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          quantity: "0.001",
          timeInForce: "GTD",
          price: "60000",
          goodTillDate: new Date(Date.now() + 30_000).toISOString(),
        },
        creds,
      ),
    ).toThrow("goodTillDate must be at least 600 seconds in the future");
  });

  it("rejects closePosition for standard futures order", () => {
    expect(() =>
      binanceOperations.place_order.makeParams?.(
        {
          marketType: "futures",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          closePosition: true,
        },
        creds,
      ),
    ).toThrow("closePosition is only supported for STOP_MARKET/TAKE_PROFIT_MARKET");
  });

  it("rejects stopPrice for trailing stop orders", () => {
    expect(() =>
      binanceOperations.place_order.makeParams?.(
        {
          marketType: "futures",
          symbol: "BTCUSDT",
          side: "SELL",
          type: "TRAILING_STOP_MARKET",
          quantity: "0.001",
          callbackRate: "0.5",
          stopPrice: "58000",
        },
        creds,
      ),
    ).toThrow("stopPrice is not supported for TRAILING_STOP_MARKET");
  });
});
