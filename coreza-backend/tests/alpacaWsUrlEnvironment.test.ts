const { getAlpacaWsUrl } = require("../market-stream-service/src/marketGateways/alpaca/helpers");

describe("alpaca websocket environment routing", () => {
  it("uses paper trading endpoint by default", () => {
    expect(getAlpacaWsUrl({}, "alpaca_trading")).toBe(
      "wss://paper-api.alpaca.markets/stream",
    );
  });

  it("uses live endpoint when environment is live", () => {
    expect(getAlpacaWsUrl({ environment: "live" }, "alpaca_trading")).toBe(
      "wss://api.alpaca.markets/stream",
    );
  });

  it("keeps backward compatibility with is_paper flag", () => {
    expect(getAlpacaWsUrl({ is_paper: false }, "alpaca_trading")).toBe(
      "wss://api.alpaca.markets/stream",
    );
  });
});
