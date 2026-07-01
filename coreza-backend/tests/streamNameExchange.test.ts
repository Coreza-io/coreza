const {
  registerBrokerCapabilities,
  BROKER_CAPABILITIES,
} = require("../src/brokers/capabilities");
const { alpacaCapabilities } = require("../src/brokers/alpaca/capabilities");
const { binanceCapabilities } = require("../src/brokers/binance/capabilities");
const { dhanCapabilities } = require("../src/brokers/dhan/capabilities");
const {
  buildStreamNames,
  parseStreamName,
} = require("../src/utils/streamName");

beforeAll(() => {
  delete BROKER_CAPABILITIES.alpaca;
  delete BROKER_CAPABILITIES.binance;
  delete BROKER_CAPABILITIES.dhan;
  registerBrokerCapabilities(alpacaCapabilities);
  registerBrokerCapabilities(binanceCapabilities);
  registerBrokerCapabilities(dhanCapabilities);
});

describe("backend stream names", () => {
  it("round-trips Dhan exchange-qualified 1m full stream names", () => {
    expect(
      buildStreamNames(
        "dhan_stream",
        ["HDFCBANK"],
        ["full"],
        "1m",
        undefined,
        "NSE_EQ",
      ),
    ).toEqual(["hdfcbank@nse_eq@full_1m"]);

    expect(parseStreamName("dhan_stream", "hdfcbank@nse_eq@full_1m")).toEqual({
      symbol: "HDFCBANK",
      eventType: "full",
      exchange: "nse_eq",
      interval: "1m",
    });
  });

  it("round-trips Dhan exchange-qualified market stream names", () => {
    expect(
      buildStreamNames(
        "dhan_stream",
        ["HDFCBANK"],
        ["ticker"],
        "",
        undefined,
        "NSE_EQ",
      ),
    ).toEqual(["hdfcbank@nse_eq@ticker"]);

    expect(parseStreamName("dhan_stream", "hdfcbank@nse_eq@ticker")).toEqual({
      symbol: "HDFCBANK",
      eventType: "ticker",
      exchange: "nse_eq",
    });
  });

  it("keeps existing Binance and Alpaca stream naming behavior unchanged", () => {
    expect(
      buildStreamNames("binance_stream", ["BTCUSDT"], ["kline"], "1m"),
    ).toEqual(["btcusdt@kline_1m"]);
    expect(parseStreamName("binance_stream", "btcusdt@kline_1m")).toEqual({
      symbol: "BTCUSDT",
      eventType: "kline",
      interval: "1m",
    });

    expect(buildStreamNames("alpaca_stream", ["AAPL"], ["bars"])).toEqual([
      "bars.AAPL",
    ]);
    expect(parseStreamName("alpaca_stream", "bars.AAPL")).toEqual({
      symbol: "AAPL",
      eventType: "bars",
    });
  });
});
