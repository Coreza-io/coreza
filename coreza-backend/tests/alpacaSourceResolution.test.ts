const { resolveStreamSourceId } = require("../src/routes/helpers/streamSource");

describe("stream source resolution", () => {
  it("routes alpaca crypto subscriptions to alpaca_crypto source", () => {
    expect(resolveStreamSourceId("alpaca", "market", "crypto")).toBe(
      "alpaca_crypto",
    );
  });

  it("routes alpaca news subscriptions to alpaca_news source", () => {
    expect(resolveStreamSourceId("alpaca", "market", "news")).toBe(
      "alpaca_news",
    );
  });

  it("normalizes category-based sources for parity", () => {
    expect(resolveStreamSourceId("alpaca", "Market", "stock")).toBe(
      "alpaca_market",
    );
    expect(resolveStreamSourceId("alpaca", undefined, "stock")).toBe(
      "alpaca_market",
    );
    expect(resolveStreamSourceId("binance", "Trading", "spot")).toBe(
      "binance_trading",
    );
  });
});
