import { TimeBarConsolidator, type ConsolidatorState } from "../src/engine/consolidation/TimeBarConsolidator";
import type { Bar } from "../src/backtest/simBroker/interfaces";
import { parseBar } from "../src/utils/barParser";
import { parseTimeframe, validateTimeframeRatio } from "../src/utils/timeframe";
import { ConsolidatorExecutor } from "../src/nodes/executors/ConsolidatorExecutor";
import type { NodeExecutionContext } from "../src/engine/types/executionContext";
import type { WorkflowNode } from "../src/nodes/types";

const bar = (timestamp: string, open: number, high = open, low = open, close = open, volume = 1): Bar =>
  ({ timestamp, open, high, low, close, volume });

describe("TimeBarConsolidator", () => {
  it("holds a 1h→4h bucket and emits correct OHLCV at the boundary", () => {
    const engine = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h" });
    let state: ConsolidatorState | undefined;
    const inputs = [
      bar("2026-01-01T00:00:00Z", 10, 12, 9, 11, 2),
      bar("2026-01-01T01:00:00Z", 11, 14, 10, 13, 3),
      bar("2026-01-01T02:00:00Z", 13, 13, 8, 9, 4),
      bar("2026-01-01T03:00:00Z", 9, 15, 9, 14, 5),
    ];
    for (const input of inputs) {
      const result = engine.update(input, state);
      expect(result.emitted).toBeUndefined();
      state = result.state;
    }
    const boundary = engine.update(bar("2026-01-01T04:00:00Z", 20), state);
    expect(boundary.emitted).toMatchObject({
      timestamp: "2026-01-01T00:00:00.000Z", endTimestamp: "2026-01-01T04:00:00.000Z",
      open: 10, high: 15, low: 8, close: 14, volume: 14,
    });
    expect(boundary.state.workingBar.open).toBe(20);
  });

  it("ignores exact duplicates and rejects conflicting or older inputs", () => {
    const engine = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h" });
    const input = bar("2026-01-01T01:00:00Z", 10);
    const first = engine.update(input);
    expect(engine.update(input, first.state).duplicate).toBe(true);
    expect(() => engine.update({ ...input, close: 11 }, first.state)).toThrow("conflicts");
    expect(() => engine.update(bar("2026-01-01T00:00:00Z", 10), first.state)).toThrow("is older");
  });

  it("aligns timezone buckets across DST and supports a 09:30 anchor", () => {
    const dst = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h", timezone: "America/New_York" });
    const dstResult = dst.update(bar("2026-03-08T07:30:00Z", 1));
    expect(dstResult.state.workingBar.timestamp).toBe("2026-03-08T05:00:00.000Z");
    expect(dstResult.state.workingBar.endTimestamp).toBe("2026-03-08T08:00:00.000Z");

    const anchored = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h", timezone: "America/New_York", anchorTime: "09:30" });
    expect(anchored.update(bar("2026-01-15T16:00:00Z", 1)).state.workingBar.timestamp)
      .toBe("2026-01-15T14:30:00.000Z");
  });

  it("aligns week buckets to Monday without shifting intraday buckets", () => {
    const weekly = new TimeBarConsolidator({ sourceTimeframe: "1d", targetTimeframe: "1w" });
    expect(weekly.update(bar("2026-01-08T12:00:00Z", 1)).state.workingBar.timestamp)
      .toBe("2026-01-05T00:00:00.000Z");

    const fiveHour = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "5h" });
    expect(fiveHour.update(bar("2026-01-01T11:00:00Z", 1)).state.workingBar.timestamp)
      .toBe("2026-01-01T09:00:00.000Z");
  });
});

describe("bar and timeframe normalization", () => {
  it("accepts historical and compact live bars and rejects non-finite values", () => {
    expect(parseBar({ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 4 })).not.toBeNull();
    expect(parseBar({ t: 1, o: 1, h: 2, l: 0, c: 1, v: 4 })).not.toBeNull();
    expect(parseBar({ t: 1, o: 1, h: Number.NaN, l: 0, c: 1, v: 4 })).toBeNull();
  });

  it("normalizes aliases and validates exact ratios", () => {
    expect(parseTimeframe("5 min").normalized).toBe("5m");
    expect(validateTimeframeRatio("1h", "1d").ratio).toBe(24);
    expect(() => validateTimeframeRatio("3h", "4h")).toThrow("exact multiple");
  });
});

describe("ConsolidatorExecutor", () => {
  it("persists a partial bucket and releases only the boundary input", () => {
    const node: WorkflowNode = {
      id: "consolidator",
      name: "Consolidator",
      node_type: "main",
      category: "Data",
      values: { symbol: "SPY", source_timeframe: "1h", target_timeframe: "4h" },
    };
    const states = new Map<string, unknown>();
    const context: NodeExecutionContext = {
      userId: "user",
      executionId: "execution",
      workflowId: "workflow",
      nodeId: node.id,
      nodes: [node],
      edges: [],
      resolvedParams: {},
      resolveNodeParameters: (node: WorkflowNode, input: Record<string, unknown>) => ({ ...node.values, ...input }),
      getAllNodeResults: () => ({}),
      checkCancellation: () => false,
      executionMode: "backtest",
      isWarmingUp: false,
      getState: (key: string) => states.get(key),
      setState: (key: string, value: unknown) => {
        states.set(key, value);
      },
    };
    const executor = new ConsolidatorExecutor();
    const held = executor.execute(node, { candle_data: bar("2026-01-01T00:00:00Z", 1) }, context);
    expect(held).toMatchObject({ success: true, data: { emitted: false }, control: { suppressDownstream: true } });
    const emitted = executor.execute(node, { candle_data: bar("2026-01-01T04:00:00Z", 2) }, context);
    expect(emitted).toMatchObject({ success: true, data: { emitted: true, bar: { open: 1 } }, control: { suppressDownstream: false } });
  });
});
