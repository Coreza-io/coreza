import { TickBarAggregator } from "../src/services/TickBarAggregator";
import { CorezaMarketEvent } from "../src/types/marketEvent";

function tick(t: number, c: number, v: number): CorezaMarketEvent {
  return {
    source: "dhan" as CorezaMarketEvent["source"],
    symbol: "HDFCBANK",
    exchange: "NSE_EQ",
    securityId: "1333",
    type: "full",
    t,
    c,
    v,
    _seq: 10,
    _orderingDomain: "dhan:full",
  };
}

describe("TickBarAggregator", () => {
  it("emits one closed 1m OHLCV bar when ticks cross a minute boundary", () => {
    const aggregator = new TickBarAggregator();
    const base = Date.UTC(2026, 0, 1, 9, 15, 0);

    expect(
      aggregator.push(
        "wf1",
        "hdfcbank@nse_eq@full_1m",
        tick(base + 1_000, 100, 1_000),
      ),
    ).toBeNull();
    expect(
      aggregator.push(
        "wf1",
        "hdfcbank@nse_eq@full_1m",
        tick(base + 20_000, 105, 1_010),
      ),
    ).toBeNull();
    expect(
      aggregator.push(
        "wf1",
        "hdfcbank@nse_eq@full_1m",
        tick(base + 40_000, 99, 1_025),
      ),
    ).toBeNull();

    const closed = aggregator.push(
      "wf1",
      "hdfcbank@nse_eq@full_1m",
      tick(base + 60_000, 102, 1_040),
    );

    expect(closed).toMatchObject({
      type: "bar",
      timeframe: "1m",
      isClosed: true,
      t: base,
      o: 100,
      h: 105,
      l: 99,
      c: 99,
      v: 25,
      symbol: "HDFCBANK",
      source: "dhan",
      exchange: "NSE_EQ",
      securityId: "1333",
      _seq: 10,
      _orderingDomain: "dhan:full",
    });
  });

  it("flushDue closes idle elapsed buckets and clears them", () => {
    const aggregator = new TickBarAggregator();
    const base = Date.UTC(2026, 0, 1, 9, 15, 0);

    aggregator.push(
      "wf1",
      "hdfcbank@nse_eq@full_1m",
      tick(base + 1_000, 100, 1_000),
    );
    aggregator.push(
      "wf1",
      "hdfcbank@nse_eq@full_1m",
      tick(base + 30_000, 103, 1_020),
    );

    const closed = aggregator.flushDue(base + 60_000);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      workflowId: "wf1",
      stream: "hdfcbank@nse_eq@full_1m",
      event: {
        type: "bar",
        timeframe: "1m",
        isClosed: true,
        o: 100,
        h: 103,
        l: 100,
        c: 103,
        v: 20,
      },
    });
    expect(aggregator.flushDue(base + 120_000)).toEqual([]);
  });
});
