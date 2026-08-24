import { DataContext } from "../src/engine/DataContext";
import { scanConsolidators } from "../src/engine/consolidation/consolidatorScan";
import { TimeBarConsolidator } from "../src/engine/consolidation/TimeBarConsolidator";
import { ConsolidatorExecutor } from "../src/nodes/executors/ConsolidatorExecutor";
import type { WorkflowNode } from "../src/nodes/types";

const input = { timestamp: "2026-01-01T00:00:00Z", open: 1, high: 3, low: 1, close: 2, volume: 4 };

describe("consolidator clock scan", () => {
  it("emits an expired bucket exactly once and rejects a late bar", () => {
    const consolidator = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h" });
    const initial = consolidator.update(input).state;
    expect(initial.sourceBarCount).toBe(1);
    expect(consolidator.scan("2026-01-01T03:59:59Z", initial).emitted).toBeUndefined();
    const scanned = consolidator.scan("2026-01-01T04:00:00Z", initial);
    expect(scanned).toMatchObject({ emissionReason: "time_scan", state: { sourceBarCount: 0 } });
    expect(scanned.state.workingBar).toBeUndefined();
    expect(consolidator.scan("2026-01-01T05:00:00Z", scanned.state).emitted).toBeUndefined();
    expect(() => consolidator.update({ ...input, timestamp: "2026-01-01T03:00:00Z" }, scanned.state))
      .toThrow(expect.objectContaining({ code: "LATE_BAR_AFTER_EMIT" }));
  });

  it("discovers registered executor state and returns its real node id", () => {
    const dataContext = new DataContext({ executionId: "scan", workflowId: "workflow", userId: "user" });
    const node: WorkflowNode = {
      id: "real-node", name: "Consolidator", node_type: "main", category: "Data",
      values: { symbol: "SPY", source_timeframe: "1h", target_timeframe: "4h" },
    };
    new ConsolidatorExecutor().execute(node, { candle_data: input }, {
      userId: "user", executionId: "scan", workflowId: "workflow", nodeId: node.id,
      nodes: [node], edges: [], resolvedParams: {}, dataContext, executionMode: "backtest",
      isWarmingUp: false, checkCancellation: () => false,
      resolveNodeParameters: (current, value) => ({ ...current.values, ...value }),
      getAllNodeResults: () => ({}), getState: () => undefined, setState: () => undefined,
    });
    expect(scanConsolidators(dataContext, "2026-01-01T04:00:00Z")).toMatchObject([
      { nodeId: "real-node", payload: { emitted: true, emissionReason: "time_scan", workingBar: null } },
    ]);
    expect(scanConsolidators(dataContext, "2026-01-01T04:00:01Z")).toEqual([]);
  });

  it("expires at timezone and anchor-aware DST boundaries", () => {
    const consolidator = new TimeBarConsolidator({
      sourceTimeframe: "1h",
      targetTimeframe: "4h",
      timezone: "America/New_York",
      anchorTime: "09:30",
    });
    const state = consolidator.update({
      ...input,
      timestamp: "2026-03-08T14:30:00Z",
    }).state;

    expect(state.workingBar?.endTimestamp).toBe("2026-03-08T17:30:00.000Z");
    expect(consolidator.scan("2026-03-08T17:29:59.999Z", state).emitted).toBeUndefined();
    expect(consolidator.scan("2026-03-08T17:30:00.000Z", state)).toMatchObject({
      emissionReason: "time_scan",
      emitted: { endTimestamp: "2026-03-08T17:30:00.000Z" },
    });
  });
});
