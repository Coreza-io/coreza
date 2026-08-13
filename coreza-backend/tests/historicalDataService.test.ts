import {
  HistoricalDataService,
  historicalBarTimestamp,
  normalizeHistoricalBars,
} from "../src/marketData/HistoricalDataService";
import type {
  HistoricalBar,
  HistoricalDataContext,
  HistoricalRangeRequest,
} from "../src/marketData/HistoricalDataService";

function bar(time: number, close = 1): HistoricalBar {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe("normalizeHistoricalBars", () => {
  it("sorts bars, removes invalid timestamps, and keeps the latest duplicate", () => {
    const invalid = { ...bar(3), time: Number.NaN };
    const normalized = normalizeHistoricalBars([
      bar(3),
      bar(1),
      bar(2, 10),
      bar(2, 20),
      invalid,
    ]);

    expect(normalized.map(historicalBarTimestamp)).toEqual([1, 2, 3]);
    expect(normalized[1].close).toBe(20);
  });

  it("normalizes provider t timestamps to the canonical time field", () => {
    const { time: _discarded, ...values } = bar(0);
    const providerBar: HistoricalBar = { ...values, t: 42 };

    expect(normalizeHistoricalBars([providerBar])).toEqual([
      expect.objectContaining({ time: 42, t: 42 }),
    ]);
  });
});

describe("HistoricalDataService.fetchPreviousBars", () => {
  it("expands the range, excludes the boundary, and returns the latest count", async () => {
    class StubHistoricalDataService extends HistoricalDataService {
      attempts = 0;

      override async fetchRange(
        _request: HistoricalRangeRequest,
        _context: HistoricalDataContext,
      ): Promise<HistoricalBar[]> {
        this.attempts += 1;
        return this.attempts === 1
          ? [bar(Date.UTC(2024, 0, 3)), bar(Date.UTC(2024, 0, 4))]
          : [
              bar(Date.UTC(2024, 0, 1)),
              bar(Date.UTC(2024, 0, 2)),
              bar(Date.UTC(2024, 0, 3)),
              bar(Date.UTC(2024, 0, 4)),
              bar(Date.UTC(2024, 0, 5)),
            ];
      }
    }

    const service = new StubHistoricalDataService();
    const result = await service.fetchPreviousBars(
      {
        provider: "test",
        symbol: "TEST",
        interval: "1d",
        count: 3,
        endExclusive: "2024-01-05T00:00:00.000Z",
      },
      {},
    );

    expect(service.attempts).toBe(2);
    expect(result.map(historicalBarTimestamp)).toEqual([
      Date.UTC(2024, 0, 2),
      Date.UTC(2024, 0, 3),
      Date.UTC(2024, 0, 4),
    ]);
  });

  it("does not call the provider when warm-up is disabled", async () => {
    const service = new HistoricalDataService({
      execute: jest.fn(),
    });

    await expect(
      service.fetchPreviousBars(
        {
          provider: "test",
          symbol: "TEST",
          interval: "1d",
          count: 0,
          endExclusive: "2024-01-05",
        },
        {},
      ),
    ).resolves.toEqual([]);
  });
});
