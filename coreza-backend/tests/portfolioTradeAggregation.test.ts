import { PortfolioManager } from "../src/simulation/PortfolioManager";

describe("PortfolioManager trade aggregation", () => {
  const userId = "user-trade-aggregation";
  let executionId = "";
  let pm: PortfolioManager;

  const openLong = (qty = 1, price = 100, symbol = "BTCUSDT") => {
    pm.applyPositionUpdate({
      symbol,
      side: "buy",
      filledQty: qty,
      avgFillPrice: price,
      currentPrice: price,
      brokerOrderId: "entry-order",
      executionId: "entry-exec",
    });
  };

  beforeEach(() => {
    executionId = `run-${Date.now()}-${Math.random()}`;
    pm = PortfolioManager.getInstance(userId, executionId);
  });

  afterEach(() => {
    pm.destroy();
  });

  it("C1: finalizes one trade for a single full exit", () => {
    openLong();
    const result = pm.applyTrade(
      {
        brokerOrderId: "exit-1",
        executionId: "exec-1",
        clientOrderId: "client-exit-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 1,
        fillPrice: 110,
        feeAmount: 0.5,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    expect(result.kind).toBe("finalized");
    expect(pm.getTrades()).toHaveLength(1);
    expect(pm.getTrades()[0]).toMatchObject({
      side: "sell",
      quantity: 1,
      entryPrice: 100,
      exitPrice: 110,
      commission: 0.5,
      grossPnl: 10,
      netPnl: 9.5,
      exitOrderId: "exit-1",
    });
  });

  it("C2: aggregates three partial fills into one finalized trade", () => {
    openLong(1, 100);

    const r1 = pm.applyTrade(
      {
        brokerOrderId: "exit-2",
        executionId: "exec-2-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0.048,
        fillPrice: 101,
        feeAmount: 0.01,
        status: "partially_filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );
    const r2 = pm.applyTrade(
      {
        brokerOrderId: "exit-2",
        executionId: "exec-2-2",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0.126,
        fillPrice: 102,
        feeAmount: 0.02,
        status: "partially_filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );
    const r3 = pm.applyTrade(
      {
        brokerOrderId: "exit-2",
        executionId: "exec-2-3",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0.826,
        fillPrice: 103,
        feeAmount: 0.03,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    expect(r1.kind).toBe("pendingUpdate");
    expect(r2.kind).toBe("pendingUpdate");
    expect(r3.kind).toBe("finalized");
    expect(pm.getTrades()).toHaveLength(1);
    const trade = pm.getTrades()[0];
    const weightedExit = 0.048 * 101 + 0.126 * 102 + 0.826 * 103;
    expect(trade.quantity).toBeCloseTo(1, 10);
    expect(trade.exitPrice).toBeCloseTo(weightedExit, 10);
    expect(trade.commission).toBeCloseTo(0.06, 10);
  });

  it("C5: finalizes on canceled status after partial fills", () => {
    openLong(1, 100);
    pm.applyTrade(
      {
        brokerOrderId: "exit-cancel",
        executionId: "exec-cancel-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0.4,
        fillPrice: 101,
        feeAmount: 0.04,
        status: "partially_filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    const result = pm.applyTrade(
      {
        brokerOrderId: "exit-cancel",
        executionId: "exec-cancel-2",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0,
        fillPrice: 101,
        feeAmount: 0,
        status: "canceled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    expect(result.kind).toBe("finalized");
    expect(pm.getTrades()).toHaveLength(1);
    expect(pm.getTrades()[0].quantity).toBeCloseTo(0.4, 10);
  });

  it("C3: partial exit finalizes trade while position remains open", () => {
    openLong(2, 100);
    const result = pm.applyTrade(
      {
        brokerOrderId: "exit-partial",
        executionId: "exec-partial-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 0.75,
        fillPrice: 105,
        feeAmount: 0.05,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    pm.applyPositionUpdate({
      symbol: "BTCUSDT",
      side: "sell",
      filledQty: 0.75,
      avgFillPrice: 105,
      currentPrice: 105,
      brokerOrderId: "exit-partial",
      executionId: "exec-partial-1",
    });

    expect(result.kind).toBe("finalized");
    expect(pm.getTrades()).toHaveLength(1);
    const position = pm.getPosition("BTCUSDT");
    expect(position?.quantity).toBeCloseTo(1.25, 10);
  });

  it("C4: two distinct exit orders finalize two trades", () => {
    openLong(2, 100);

    pm.applyTrade(
      {
        brokerOrderId: "exit-order-a",
        executionId: "exec-a-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 1,
        fillPrice: 102,
        feeAmount: 0.02,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );
    pm.applyPositionUpdate({
      symbol: "BTCUSDT",
      side: "sell",
      filledQty: 1,
      avgFillPrice: 102,
      currentPrice: 102,
      brokerOrderId: "exit-order-a",
      executionId: "exec-a-1",
    });

    pm.applyTrade(
      {
        brokerOrderId: "exit-order-b",
        executionId: "exec-b-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 1,
        fillPrice: 103,
        feeAmount: 0.02,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    expect(pm.getTrades()).toHaveLength(2);
    expect(pm.getTrades()[0].exitOrderId).toBe("exit-order-a");
    expect(pm.getTrades()[1].exitOrderId).toBe("exit-order-b");
  });

  it("C6: reversal closes and then reopens opposite position", () => {
    openLong(1, 100);
    const result = pm.applyTrade(
      {
        brokerOrderId: "exit-reversal",
        executionId: "exec-reversal-1",
        symbol: "BTCUSDT",
        side: "sell",
        filledQty: 1.4,
        fillPrice: 95,
        feeAmount: 0.1,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );

    pm.applyPositionUpdate({
      symbol: "BTCUSDT",
      side: "sell",
      filledQty: 1.4,
      avgFillPrice: 95,
      currentPrice: 95,
      brokerOrderId: "exit-reversal",
      executionId: "exec-reversal-1",
    });

    expect(result.kind).toBe("finalized");
    expect(pm.getTrades()).toHaveLength(1);
    expect(pm.getTrades()[0].quantity).toBeCloseTo(1, 10);
    const position = pm.getPosition("BTCUSDT");
    expect(position?.quantity).toBeCloseTo(-0.4, 10);
  });

  it("idempotency: duplicate executionId is skipped", () => {
    openLong();
    const payload = {
      brokerOrderId: "exit-dup",
      executionId: "dup-exec",
      symbol: "BTCUSDT",
      side: "sell" as const,
      filledQty: 0.5,
      fillPrice: 104,
      feeAmount: 0.01,
      status: "partially_filled",
      baseCurrency: "USDT",
    };
    const r1 = pm.applyTrade(payload, new Date().toISOString());
    const r2 = pm.applyTrade(payload, new Date().toISOString());

    expect(r1.kind).toBe("pendingUpdate");
    expect(r2).toEqual({ kind: "skipped", reason: "duplicate_execution" });
    expect(pm.getTrades()).toHaveLength(0);
  });

  it("same-direction fills are skipped", () => {
    openLong();
    const result = pm.applyTrade(
      {
        brokerOrderId: "buy-more",
        executionId: "buy-more-1",
        symbol: "BTCUSDT",
        side: "buy",
        filledQty: 0.25,
        fillPrice: 101,
        feeAmount: 0.01,
        status: "filled",
        baseCurrency: "USDT",
      },
      new Date().toISOString(),
    );
    expect(result).toEqual({ kind: "skipped", reason: "same_direction_fill" });
  });
});
