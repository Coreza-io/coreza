import {
  IndicatorStateManager,
  requiredWarmupBars,
} from "../src/engine/indicatorStateManager";
import { discoverIndicators } from "../src/nodes/executors/InitializeIndicatorsExecutor";
import { IndicatorService } from "../src/nodes/logic/indicators";
import type { WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const bars = [
  { time: 1, high: 10, low: 8, close: 9 },
  { time: 2, high: 12, low: 9, close: 11 },
  { time: 3, high: 13, low: 10, close: 10.5 },
  { time: 4, high: 12, low: 7, close: 8 },
];

describe("ATR indicator", () => {
  it("seeds from the first bar and then applies Wilder smoothing", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
    });
    const first = updater.warmUp(bars.slice(0, 1));
    const warmed = updater.warmUp(bars);

    expect(first).toMatchObject({ value: null });
    expect(first.internalState).toMatchObject({ count: 1, trSum: 2 });
    expect(warmed.internalState.count).toBe(4);
    expect(warmed.internalState.trSum).toBe(8);
    expect(warmed.value).toBeCloseTo(3.444444444, 9);
    expect(updater.warmUp(bars.slice(0, 3)).value).toBeCloseTo(
      2.666666667,
      9,
    );
    expect(updater.warmUp(bars.slice(0, 2)).value).toBeNull();
  });

  it("uses gaps and the normal high-low range when computing true range", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 1,
    });
    const result = updater.warmUp([{ high: 10, low: 8, close: 9 }]);
    expect(result.value).toBe(2);
    expect(
      updater.update(result.internalState, { high: 14, low: 12, close: 13 })
        .value,
    ).toBe(5);
    expect(
      updater.update(result.internalState, { high: 11, low: 7, close: 8 })
        .value,
    ).toBe(6);
    expect(
      updater.update(result.internalState, { high: 9, low: 8, close: 8.5 })
        .value,
    ).toBe(1);
  });

  it("retains the complete state and previous value for malformed bars", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 2,
    });
    const warmed = updater.warmUp(bars.slice(0, 2));
    const before = structuredClone(warmed.internalState);
    const result = updater.update(warmed.internalState, {
      high: "bad",
      low: 1,
      close: 2,
    });

    expect(result.value).toBe(warmed.value);
    expect(result.internalState).toEqual(before);
  });

  it.each([0, -1, "invalid", 1.5])(
    "rejects invalid period %p in both paths",
    async (period) => {
      expect(() =>
        IndicatorService.createIncrementalUpdater("atr", { period }),
      ).toThrow("positive integer");
      const result = await IndicatorService.calculateATR({
        candle_data: bars,
        period,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("positive integer");
    },
  );

  it("rejects malformed candles in the batch path", async () => {
    const result = await IndicatorService.calculateATR({
      candle_data: [...bars, { high: 1, low: "bad", close: 1 }],
      period: 3,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid numeric value in candles");
  });

  it("keeps batch, full warm-up, split warm-up, and update paths identical", async () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
    });
    const full = updater.warmUp(bars);
    const partial = updater.warmUp(bars.slice(0, -1));
    const incremental = updater.update(partial.internalState, bars.at(-1));
    const batch = await IndicatorService.calculateATR({
      candle_data: bars,
      period: 3,
    });

    expect(batch.data?.slice(0, 2)).toEqual([null, null]);
    expect(batch.data?.[2]).toBeCloseTo(8 / 3, 12);
    expect(batch.data?.[3]).toBeCloseTo(31 / 9, 12);
    expect(batch.data?.at(-1)).toBe(full.value);
    expect(full.value).toBe(incremental.value);
    expect(full.internalState).toEqual(incremental.internalState);
  });

  it("reports not ready before period valid bars", async () => {
    const manager = new IndicatorStateManager();
    const state = await manager.warmUp(
      "not-ready",
      "atr",
      { period: 3 },
      bars.slice(0, 2),
      true,
    );
    expect(state).toMatchObject({ currentValue: null, isReady: false });
  });

  it(
    "uses period bars for readiness and ignores duplicate/out-of-order updates",
    async () => {
      const asyncManager = new IndicatorStateManager();
      const syncManager = new IndicatorStateManager();
      const initialAsync = await asyncManager.warmUp(
        "async",
        "atr",
        { period: 3 },
        bars.slice(0, 3),
        true,
      );
      const initialSync = await syncManager.warmUp(
        "sync",
        "atr",
        { period: 3 },
        bars.slice(0, 3),
        true,
      );
      expect(requiredWarmupBars("atr", { period: 3 })).toBe(3);
      expect(initialAsync.isReady).toBe(true);

      const asyncState = await asyncManager.update("async", bars[3], true);
      const syncState = syncManager.updateSync("sync", bars[3]);
      expect(asyncState).toEqual(syncState);
      const snapshot = structuredClone(syncState);
      expect(syncManager.updateSync("sync", bars[3])).toEqual(snapshot);
      expect(
        syncManager.updateSync("sync", { ...bars[3], time: 2 }),
      ).toEqual(snapshot);
      expect(initialSync.requiredWarmupBars).toBe(3);
    },
  );

  it("is discovered as a generic downstream indicator", () => {
    const nodes: WorkflowNode[] = [
      {
        id: "initialize",
        name: "InitializeIndicators",
        node_type: "main",
        category: "Indicators",
      },
      {
        id: "atr",
        name: "ATR",
        node_type: "main",
        category: "Indicators",
        values: { period: 3 },
      },
    ];
    const edges: WorkflowEdge[] = [
      { id: "initialize-atr", source: "initialize", target: "atr" },
    ];

    expect(discoverIndicators("initialize", nodes, edges)).toEqual([
      { nodeId: "atr", type: "atr", params: { period: 3 } },
    ]);
  });
});
