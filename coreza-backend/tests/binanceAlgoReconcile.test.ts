import { binanceOperations } from "../src/brokers/binance/http/operations";
import axios from "axios";

describe("Binance algo order reconciliation operation", () => {
  afterEach(() => jest.restoreAllMocks());

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

  it("falls back to all algo orders and filters by clientAlgoId", async () => {
    const operation = binanceOperations.get_algo_order_by_client_id;
    const get = jest.spyOn(axios, "get")
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({
        data: [
          { clientAlgoId: "other", algoId: 1 },
          { clientAlgoId: "effect-123", algoId: 2 },
        ],
      });
    const input = {
      marketType: "futures",
      environment: "testnet",
      symbol: "BTCUSDT",
      client_order_id: "effect-123",
    };

    await expect(operation.execute?.({
      input,
      creds: { secret_key: "secret" },
      baseUrl: "https://testnet.binancefuture.com",
      headers: {},
      request: axios,
    })).resolves.toMatchObject({ clientAlgoId: "effect-123", algoId: 2 });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toContain("/fapi/v1/algoOrder");
    expect(get.mock.calls[0][1]).toMatchObject({ params: { clientAlgoId: "effect-123" } });
    expect(get.mock.calls[1][0]).toContain("/fapi/v1/allAlgoOrders");
  });
});
