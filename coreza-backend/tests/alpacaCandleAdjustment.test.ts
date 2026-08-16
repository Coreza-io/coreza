import { alpacaOperations } from "../src/brokers/alpaca/http/operations";

const getCandleParams = (input: Record<string, unknown>) =>
  alpacaOperations.get_candle.makeParams!({
    symbol: "AAPL",
    interval: "1Day",
    start: "2024-01-01",
    ...input,
  });

describe("Alpaca get_candle adjustment", () => {
  it("defaults equities to raw adjustment and ascending sort", () => {
    expect(getCandleParams({ asset_type: "stock" })).toEqual(
      expect.objectContaining({ adjustment: "raw", sort: "asc" }),
    );
  });

  it("trims and passes through combined adjustments", () => {
    expect(
      getCandleParams({
        asset_type: "stock",
        adjustment: " split, spin-off ",
      }).adjustment,
    ).toBe("split,spin-off");
  });

  it("rejects an unknown adjustment token with a clear error", () => {
    expect(() =>
      getCandleParams({ asset_type: "stock", adjustment: "split,merger" }),
    ).toThrow('Invalid Alpaca bar adjustment "merger"');
  });

  it("omits adjustment from crypto requests", () => {
    expect(
      getCandleParams({ asset_type: "crypto", adjustment: "split" }),
    ).not.toHaveProperty("adjustment");
  });
});
