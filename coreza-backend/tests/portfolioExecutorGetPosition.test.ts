jest.mock("../src/repositories/LiveTradeRepository", () => ({
  LiveTradeRepository: jest.fn(),
}));
jest.mock("../src/nodes/executors/BrokerExecutor", () => ({
  BrokerExecutor: jest.fn(),
}));

const { PortfolioExecutor } = require("../src/nodes/executors/PortfolioExecutor");

export {};

describe("PortfolioExecutor get_position", () => {
  const openPosition = {
    symbol: "BTCUSDT",
    side: "long",
    quantity: 2,
    avgFillPrice: 100,
    currentPrice: 110,
    unrealizedPnl: 20,
    realizedPnl: 5,
    marketValue: 220,
    openCostBasis: 200,
  };

  const broker = {
    getPortfolioState: () => ({ positions: { BTCUSDT: openPosition } }),
    getPosition: (symbol: string) =>
      symbol === openPosition.symbol ? openPosition : null,
    updateAllPositionsMTM: jest.fn(),
  };

  const execute = (symbol?: string) => {
    PortfolioExecutor.setSimBrokerCache(
      new Map([["simBroker:position-shape", broker]]),
    );
    const executor = new PortfolioExecutor();
    return executor.execute({
      id: "portfolio-1",
      name: "Portfolio",
      node_type: "portfolio",
      values: {
        mode: "backtest",
        operation: "get_position",
        backtestId: "position-shape",
        symbol,
      },
    }, {});
  };

  it.each([
    ["a matching symbol", "BTCUSDT", [openPosition]],
    ["a blank symbol", undefined, [openPosition]],
    ["a symbol without an open position", "ETHUSDT", []],
  ])("always returns positions as an array for %s", (_case, symbol, expected) => {
    const result = execute(symbol);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.positions)).toBe(true);
    expect(result.data.positions).toMatchObject(expected);
    expect(result.data.has_position).toBe(expected.length > 0);
    expect(result.data.count).toBe(expected.length);
    expect(result.data.position).toEqual(
      expected[0]
        ? expect.objectContaining(expected[0])
        : null,
    );
  });
});
