import {
  getReconciliationCapability,
  resolveOrderKind,
} from "../src/brokers/reconciliationCapabilities";

describe("broker scan reconciliation capability", () => {
  it("blocks close-position and Binance futures algo orders", () => {
    expect(getReconciliationCapability("alpaca", "close_position").liveScanAllowed).toBe(false);
    const kind = resolveOrderKind("binance", { marketType: "futures", type: "STOP_MARKET" });
    expect(kind).toBe("algo");
    expect(getReconciliationCapability("binance", "place_order", kind)).toEqual({
      support: "algo_client_id",
      liveScanAllowed: false,
    });
  });

  it("allows client-id-reconcilable standard placements", () => {
    expect(getReconciliationCapability("alpaca", "place_order").liveScanAllowed).toBe(true);
    expect(getReconciliationCapability("binance", "place_order", "standard").liveScanAllowed).toBe(true);
    expect(getReconciliationCapability("unknown", "place_order").liveScanAllowed).toBe(false);
  });
});
