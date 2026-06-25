import type { BrokerOperationExecuteContext } from "../src/brokers/types";
import {
  fetchDhanCandles,
  parseDhanSymbols,
} from "../src/brokers/dhan/helpers";
import { dhanOperations } from "../src/brokers/dhan/http/operations";
import { lookupSecurityId } from "../src/brokers/dhan/scripMaster";

jest.mock("../src/brokers/dhan/scripMaster", () => ({
  lookupSecurityId: jest.fn(),
}));

const mockedLookupSecurityId = jest.mocked(lookupSecurityId);

function createContext(symbol: string, interval = "5") {
  const request = {
    post: jest.fn(async () => ({
      data: {
        timestamp: [1710000000000],
        open: [100],
        high: [110],
        low: [90],
        close: [105],
        volume: [1234],
      },
    })),
  };

  const ctx = {
    input: {
      symbol,
      exchangeSegment: "NSE_EQ",
      instrument: "EQUITY",
      interval,
      start: "2026-06-24 09:15:00",
      end: "2026-06-24 15:30:00",
    },
    creds: {},
    baseUrl: "https://api.dhan.test/v2",
    headers: { Authorization: "Bearer token" },
    request,
  } as unknown as BrokerOperationExecuteContext;

  return { ctx, request };
}

describe("Dhan candle fan-out", () => {
  beforeEach(() => {
    mockedLookupSecurityId.mockImplementation(async (symbol: string) => {
      if (symbol === "INVALID") return "";
      return `SEC-${symbol}`;
    });
  });

  it("keeps get_candle on the custom execute hook", () => {
    expect(dhanOperations.get_candle.execute).toBe(fetchDhanCandles);
  });

  it("parses, trims, uppercases, and deduplicates comma-separated symbols", () => {
    expect(parseDhanSymbols(" HDFCBANK, ICICIBANK, HDFCBANK ,, ")).toEqual([
      "HDFCBANK",
      "ICICIBANK",
    ]);
  });

  it("fetches one symbol with one request and one BarSeries item", async () => {
    const { ctx, request } = createContext("HDFCBANK");

    const result = await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledTimes(1);
    expect(result.BarSeries).toHaveLength(1);
    expect(result.BarSeries[0].symbol).toBe("HDFCBANK");
  });

  it("fans out two comma-separated symbols into two requests and two BarSeries items", async () => {
    const { ctx, request } = createContext("HDFCBANK, ICICIBANK");

    const result = await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledTimes(2);
    expect(result.BarSeries.map((series) => series.symbol)).toEqual([
      "HDFCBANK",
      "ICICIBANK",
    ]);
  });

  it("deduplicates and trims symbols before requesting candles", async () => {
    const { ctx, request } = createContext(" HDFCBANK, ICICIBANK, HDFCBANK ,, ");

    await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it("uses the historical endpoint for daily candles", async () => {
    const { ctx, request } = createContext("HDFCBANK", "Day");

    await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledWith(
      "https://api.dhan.test/v2/charts/historical",
      expect.objectContaining({ securityId: "SEC-HDFCBANK" }),
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("uses the intraday endpoint for intraday candles", async () => {
    const { ctx, request } = createContext("HDFCBANK", "5");

    await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledWith(
      "https://api.dhan.test/v2/charts/intraday",
      expect.objectContaining({ securityId: "SEC-HDFCBANK", interval: "5" }),
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("includes the invalid ticker in batch failure errors", async () => {
    const { ctx } = createContext("HDFCBANK, INVALID");

    await expect(fetchDhanCandles(ctx)).rejects.toThrow(
      /Unable to fetch candles for INVALID:/,
    );
  });

  it("preserves existing single-symbol response shape", async () => {
    const { ctx } = createContext("HDFCBANK");

    await expect(fetchDhanCandles(ctx)).resolves.toEqual({
      BarSeries: [
        {
          symbol: "HDFCBANK",
          interval: "5",
          bars: [
            {
              time: 1710000000000,
              open: 100,
              high: 110,
              low: 90,
              close: 105,
              volume: 1234,
            },
          ],
        },
      ],
      next_page_token: null,
      has_more: false,
    });
  });

  it("caps concurrent candle requests at five", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const symbols = Array.from({ length: 20 }, (_, index) => `SYM${index}`);
    const { ctx, request } = createContext(symbols.join(","));

    request.post.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return {
        data: {
          timestamp: [1710000000000],
          open: [100],
          high: [110],
          low: [90],
          close: [105],
          volume: [1234],
        },
      };
    });

    await fetchDhanCandles(ctx);

    expect(request.post).toHaveBeenCalledTimes(20);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});
