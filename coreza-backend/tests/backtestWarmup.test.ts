import { buildWarmupEvents } from "../src/backtest/warmup/WarmupReplay";
import {
  enforceWarmupPolicy,
  resolveWarmupPolicy,
} from "../src/backtest/warmup/WarmupPolicy";
import type { WorkflowNode } from "../src/nodes/types";
import { IndicatorStateManager } from "../src/engine/indicatorStateManager";
import { SimBroker } from "../src/backtest/simBroker";

const node = (name: string, category: string): WorkflowNode => ({
  id: name,
  name,
  node_type: "main",
  category,
});

describe("workflow replay warm-up", () => {
  it("uses safe-by-default centralized node policies", () => {
    expect(resolveWarmupPolicy(node("Indicators", "Indicators"))).toBe(
      "execute",
    );
    expect(resolveWarmupPolicy(node("Compute", "ControlFlow"))).toBe("execute");
    expect(resolveWarmupPolicy(node("BacktestTrade", "BacktestTrade"))).toBe(
      "reject",
    );
    expect(enforceWarmupPolicy(node("Webhook", "Integration"))).toEqual({
      success: true,
      data: null,
      warmupSuppressed: true,
    });
  });

  it("does not cap a longer symbol history", () => {
    const bar = (time: number) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    });
    const events = buildWarmupEvents(
      new Map([
        ["SHORT", [bar(2)]],
        ["LONG", [bar(1), bar(2), bar(3)]],
      ]),
      "1d",
    );

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.symbols)).toEqual([
      ["LONG"],
      ["SHORT", "LONG"],
      ["SHORT", "LONG"],
    ]);
    expect(events[2].bars.SHORT).toMatchObject({
      time: 3,
      _sourceTimestamp: 2,
      _isFillForward: true,
    });
  });

  it("initializes indicators empty before processing replay bars once", async () => {
    const manager = new IndicatorStateManager();
    const initial = await manager.initialize(
      "indicator-key",
      "sma",
      { period: 2 },
      true,
    );

    expect(initial).toMatchObject({
      currentValue: null,
      warmupCompleted: false,
      isReady: false,
      observedBars: 0,
      requiredWarmupBars: 2,
    });
    manager.updateSync("indicator-key", { time: 1, close: 10 });
    const ready = manager.updateSync("indicator-key", { time: 2, close: 12 });
    expect(ready.observedBars).toBe(2);
    expect(ready.isReady).toBe(true);
    expect(manager.markWarmupCompleted("indicator-key")?.warmupCompleted).toBe(
      true,
    );
  });

  it("blocks broker mutation paths and fill processing during warm-up", () => {
    const broker = new SimBroker("warmup-test");
    const pending = broker.placeOrder({
      symbol: "AAPL",
      side: "buy",
      orderType: "market",
      quantity: 1,
    });
    expect(pending.success).toBe(true);
    if (!pending.orderId) throw new Error("Expected pending order id");

    broker.setWarmingUp(true);
    expect(
      broker.placeOrder({
        symbol: "AAPL",
        side: "buy",
        orderType: "market",
        quantity: 1,
      }),
    ).toEqual({ success: false, error: "ORDER_DURING_WARMUP" });
    expect(broker.cancelOrder(pending.orderId)).toBe(false);
    expect(broker.markOrderReplaced(pending.orderId)).toBe(false);
    expect(broker.liquidate("AAPL")).toMatchObject({
      success: false,
      error: "ORDER_DURING_WARMUP",
    });

    const fills = broker.onBar(
      {
        symbol: "AAPL",
        bar: {
          timestamp: 1,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        },
        sourceTimestamp: 1,
        eventTimestamp: 1,
        isFillForward: false,
      },
      { warmup: true },
    );
    expect(fills).toEqual([]);
    expect(
      broker.getPortfolioState().tickets[pending.orderId].quantityFilled,
    ).toBe(0);
  });
});
