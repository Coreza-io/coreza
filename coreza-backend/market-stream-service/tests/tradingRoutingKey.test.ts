import { tradingRoutingKey } from "../src/utils/streamName";

describe("tradingRoutingKey", () => {
  it("returns trade_updates for alpaca trading", () => {
    expect(tradingRoutingKey("alpaca_trading", "trade_updates")).toBe(
      "trade_updates",
    );
  });

  it("returns native event names for binance trading", () => {
    expect(
      tradingRoutingKey("binance_trading", "ORDER_TRADE_UPDATE"),
    ).toBe("ORDER_TRADE_UPDATE");
    expect(tradingRoutingKey("binance_trading", "ALGO_UPDATE")).toBe(
      "ALGO_UPDATE",
    );
    expect(tradingRoutingKey("binance_trading", "executionReport")).toBe(
      "executionReport",
    );
  });
});
