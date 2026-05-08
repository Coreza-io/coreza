import { computeTradingNativeStreamsFromConfig, getBrokerStreamConfig } from "../src/config/brokerStreamConfig";
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

  it("supports alpaca account trading stream shape", () => {
    expect(computeTradingNativeStreamsFromConfig("alpaca_trading", "spot")).toEqual(["trade_updates"]);
    expect(computeTradingNativeStreamsFromConfig("alpaca_trading", "futures")).toEqual(["trade_updates"]);
    expect(computeTradingNativeStreamsFromConfig("alpaca_trading")).toEqual(["trade_updates"]);
  });

  it("resolves alpaca stream crypto symbols to alpaca_crypto", () => {
    const cfg = getBrokerStreamConfig("alpaca_stream");
    expect(cfg.resolveSourceForSymbol?.("ETH/USDT", "alpaca_stream")).toBe("alpaca_crypto");
    expect(cfg.resolveSourceForSymbol?.("AAPL", "alpaca_stream")).toBe("alpaca_stream");
  });
});
