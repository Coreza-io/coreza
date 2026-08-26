import {
  getReconciliationCapability,
  resolveOrderKind,
} from "../src/brokers/reconciliationCapabilities";
jest.mock("../src/config/supabase", () => ({ supabase: {} }));
jest.mock("../src/brokers/dhan/scripMaster", () => ({}));
import { BrokerExecutor } from "../src/nodes/executors/BrokerExecutor";
import type { WorkflowNode } from "../src/nodes/types";

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

  it.each([
    ["alpaca", "close_position", { symbol: "SPY" }],
    ["binance", "place_order", { symbol: "BTCUSDT", marketType: "futures", type: "STOP_MARKET" }],
  ])("returns SCAN_UNSAFE_OPERATION for %s.%s before claiming", async (broker, operation, params) => {
    const node: WorkflowNode = {
      id: "broker-node",
      name: broker,
      subCategory: broker,
      node_type: "main",
      category: "Broker",
      values: { credential_id: "credential", operation, ...params },
    };
    const context = {
      userId: "user",
      workflowId: "workflow",
      runId: "run",
      emissionId: "emission",
      resolveNodeParameters: (current: WorkflowNode) => current.values ?? {},
    };

    await expect(new BrokerExecutor().execute(node, {}, context)).resolves.toMatchObject({
      success: false,
      code: "SCAN_UNSAFE_OPERATION",
    });
  });
});
