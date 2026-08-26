import { binanceOperations } from "../src/brokers/binance/http/operations";

describe("Binance algo order reconciliation operation", () => {
  it("looks up a futures algo order with clientAlgoId", () => {
    const operation = binanceOperations.get_algo_order_by_client_id;
    const input = {
      marketType: "futures",
      environment: "testnet",
      symbol: "BTCUSDT",
      client_order_id: "effect-123",
    };
    expect(typeof operation).toBe("object");
    expect(typeof operation.path === "function" ? operation.path(input, {}) : operation.path)
      .toBe("/fapi/v1/algoOrder");
    const params = operation.makeParams?.(input, { secret_key: "secret" }) as Record<string, unknown>;
    expect(params.clientAlgoId).toBe("effect-123");
    expect(params.origClientOrderId).toBeUndefined();
  });
});
