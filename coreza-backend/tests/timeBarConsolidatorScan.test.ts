import { DataContext } from "../src/engine/DataContext";
import { commitConsolidatorEmissions, scanConsolidators } from "../src/engine/consolidation/consolidatorScan";
import { TimeBarConsolidator } from "../src/engine/consolidation/TimeBarConsolidator";
import { ConsolidatorExecutor } from "../src/nodes/executors/ConsolidatorExecutor";
import { isConsolidatorState } from "../src/engine/consolidation/consolidatorShared";
import { consolidatorLateBarRejectsCounter } from "../src/utils/metrics";
import type { WorkflowNode } from "../src/nodes/types";

const input = { timestamp: "2026-01-01T00:00:00Z", open: 1, high: 3, low: 1, close: 2, volume: 4 };

describe("consolidator clock scan", () => {
  it("rejects a working bar with an invalid bucket end", () => {
    expect(isConsolidatorState({
      sourceBarCount: 1,
      workingBar: { ...input, endTimestamp: "broken" },
    })).toBe(false);
  });

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

  it("treats a bar behind the emitted watermark as a suppressed, metered drop", async () => {
    const dataContext = new DataContext({ executionId: "late", workflowId: "workflow", userId: "user" });
    const node: WorkflowNode = {
      id: "late-node", name: "Consolidator", node_type: "main", category: "Data",
      values: { symbol: "SPY", source_timeframe: "1h", target_timeframe: "4h" },
    };
    const context = {
      userId: "user", executionId: "late", workflowId: "workflow", nodeId: node.id,
      nodes: [node], edges: [], resolvedParams: {}, dataContext, executionMode: "backtest" as const,
      isWarmingUp: false, checkCancellation: () => false,
      resolveNodeParameters: (current: WorkflowNode, value: Record<string, unknown>) => ({ ...current.values, ...value }),
      getAllNodeResults: () => ({}), getState: () => undefined, setState: () => undefined,
    };
    const executor = new ConsolidatorExecutor();
    executor.execute(node, { candle_data: input }, context);
    scanConsolidators(dataContext, "2026-01-01T04:00:00Z");
    const before = (await consolidatorLateBarRejectsCounter.get()).values[0]?.value ?? 0;
    expect(executor.execute(node, { candle_data: { ...input, timestamp: "2026-01-01T03:00:00Z" } }, context))
      .toMatchObject({ success: true, data: { lateBarDropped: true }, control: { suppressDownstream: true } });
    const after = (await consolidatorLateBarRejectsCounter.get()).values[0]?.value ?? 0;
    expect(after).toBe(before + 1);
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

  it("honors a per-consolidator feed-latency grace", () => {
    const dataContext = new DataContext({ executionId: "grace", workflowId: "workflow", userId: "user" });
    const node: WorkflowNode = {
      id: "grace-node", name: "Consolidator", node_type: "main", category: "Data",
      values: { symbol: "SPY", source_timeframe: "1h", target_timeframe: "4h", scan_grace_ms: 60_000 },
    };
    new ConsolidatorExecutor().execute(node, { candle_data: input }, {
      userId: "user", executionId: "grace", workflowId: "workflow", nodeId: node.id,
      nodes: [node], edges: [], resolvedParams: {}, dataContext, executionMode: "backtest",
      isWarmingUp: false, checkCancellation: () => false,
      resolveNodeParameters: (current, value) => ({ ...current.values, ...value }),
      getAllNodeResults: () => ({}), getState: () => undefined, setState: () => undefined,
    });

    expect(scanConsolidators(dataContext, "2026-01-01T04:00:59.999Z", { commit: false })).toEqual([]);
    expect(scanConsolidators(dataContext, "2026-01-01T04:01:00.000Z", { commit: false })).toHaveLength(1);
  });

  it("re-emits an uncommitted candidate and stops after a successful commit", () => {
    const dataContext = new DataContext({ executionId: "retry", workflowId: "workflow", userId: "user" });
    const node: WorkflowNode = {
      id: "retry-node", name: "Consolidator", node_type: "main", category: "Data",
      values: { symbol: "SPY", source_timeframe: "1h", target_timeframe: "4h" },
    };
    new ConsolidatorExecutor().execute(node, { candle_data: input }, {
      userId: "user", executionId: "retry", workflowId: "workflow", nodeId: node.id,
      nodes: [node], edges: [], resolvedParams: {}, dataContext, executionMode: "backtest",
      isWarmingUp: false, checkCancellation: () => false,
      resolveNodeParameters: (current, value) => ({ ...current.values, ...value }),
      getAllNodeResults: () => ({}), getState: () => undefined, setState: () => undefined,
    });

    const first = scanConsolidators(dataContext, "2026-01-01T04:00:00Z", { commit: false });
    const retry = scanConsolidators(dataContext, "2026-01-01T04:00:01Z", { commit: false });
    expect(retry.map((emission) => emission.emissionId)).toEqual(first.map((emission) => emission.emissionId));
    commitConsolidatorEmissions(dataContext, retry);
    expect(scanConsolidators(dataContext, "2026-01-01T04:00:02Z", { commit: false })).toEqual([]);
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
