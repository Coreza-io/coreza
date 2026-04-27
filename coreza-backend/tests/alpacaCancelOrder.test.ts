const { alpacaOperations } = require("../src/brokers/alpaca/http/operations");

describe("alpaca operations parity", () => {
  it("supports single cancel by order_id", () => {
    const path = alpacaOperations.cancel_order.path({ order_id: "abc-123" });
    expect(path).toBe("/v2/orders/abc-123");
  });

  it("throws clear error when cancel_order is missing order_id", () => {
    expect(() => alpacaOperations.cancel_order.path({})).toThrow(
      "order_id is required for cancel_order",
    );
  });

  it("keeps cancel_all_orders and legacy cancel_orders mapped to bulk endpoint", () => {
    expect(alpacaOperations.cancel_orders.path).toBe("/v2/orders");
    expect(alpacaOperations.cancel_all_orders.path).toBe("/v2/orders");
  });

  it("supports get_order lookup by id", () => {
    const path = alpacaOperations.get_order.path({ order_id: "ord-1" });
    expect(path).toBe("/v2/orders/ord-1");
  });

  it("builds crypto symbol from base/quote for place_order and close_position", () => {
    const body = alpacaOperations.place_order.makeBody({
      assetType: "crypto",
      crypto_base: "btc",
      crypto_quote: "usd",
      qty: "1",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
    });
    expect(body.symbol).toBe("BTC/USD");

    const closePath = alpacaOperations.close_position.path({
      assetType: "crypto",
      crypto_base: "ETH",
      crypto_quote: "USD",
    });
    expect(closePath).toBe("/v2/positions/ETHUSD");
  });
});
