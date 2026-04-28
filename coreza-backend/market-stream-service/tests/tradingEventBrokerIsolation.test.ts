import { parseStreamName } from "../src/utils/streamName";

describe("trading stream broker isolation", () => {
  it("keeps alpaca and binance native trading streams disjoint", () => {
    expect(parseStreamName("alpaca_trading", "trade_updates").streamType).toBe(
      "trade_updates",
    );
    expect(
      parseStreamName("binance_trading", "ALGO_UPDATE").streamType,
    ).toBe("ALGO_UPDATE");
    expect(
      parseStreamName("binance_trading", "executionReport").streamType,
    ).toBe("executionReport");
  });
});
