import { DataContext } from "../src/engine/DataContext";
import {
  drainDeliveredConsolidatorEmissions,
  scanConsolidators,
} from "../src/engine/consolidation/consolidatorScan";
import { TimeBarConsolidator } from "../src/engine/consolidation/TimeBarConsolidator";

describe("consolidator receipt drain", () => {
  it("commits pending state for a receipt without returning it for downstream execution", () => {
    const dataContext = new DataContext({ executionId: "execution", workflowId: "workflow", userId: "user" });
    const metadata = {
      kind: "consolidator_state" as const,
      nodeId: "consolidator",
      symbol: "SPY",
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
      timezone: "UTC",
      anchorTime: "",
    };
    const state = new TimeBarConsolidator(metadata).update({
      timestamp: "2026-01-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1,
    }).state;
    dataContext.setData("working", state, metadata);
    const candidates = scanConsolidators(dataContext, "2026-01-01T04:00:00Z", { commit: false });

    const remaining = drainDeliveredConsolidatorEmissions(
      dataContext,
      candidates,
      new Set([candidates[0].emissionId]),
    );

    expect(remaining).toEqual([]);
    expect(scanConsolidators(dataContext, "2026-01-01T04:00:01Z", { commit: false })).toEqual([]);
  });
});
