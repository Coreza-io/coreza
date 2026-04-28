import { normalizeOrderSymbol } from "../src/utils/symbolNormalize";

describe("trading symbol normalization", () => {
  it("normalizes Alpaca slash symbols to compact uppercase", () => {
    expect(normalizeOrderSymbol("ETH/USD", "alpaca")).toBe("ETHUSD");
  });

  it("keeps Binance symbols uppercase", () => {
    expect(normalizeOrderSymbol("btcusdt", "binance")).toBe("BTCUSDT");
  });
});
