import { DataContext } from "../src/engine/DataContext";
import { scanConsolidators } from "../src/engine/consolidation/consolidatorScan";
import { TimeBarConsolidator } from "../src/engine/consolidation/TimeBarConsolidator";

describe("deterministic backtest consolidator grace", () => {
  it("emits at the finite clock boundary only when live node grace is disabled", () => {
    const dataContext = new DataContext({ executionId: "backtest", workflowId: "workflow", userId: "user" });
    const metadata = {
      kind: "consolidator_state" as const,
      nodeId: "consolidator",
      symbol: "SPY",
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
      timezone: "UTC",
      anchorTime: "",
      scanGraceMs: 60_000,
    };
    const state = new TimeBarConsolidator(metadata).update({
      timestamp: "2026-01-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1,
    }).state;
    dataContext.setData("working", state, metadata);

    expect(scanConsolidators(dataContext, "2026-01-01T04:00:00Z", {
      commit: false,
      gracePolicy: "node",
    })).toEqual([]);
    expect(scanConsolidators(dataContext, "2026-01-01T04:00:00Z", {
      commit: false,
      gracePolicy: "none",
    })).toMatchObject([{ payload: { appliedGraceMs: 0, emitted: true } }]);
  });
});
