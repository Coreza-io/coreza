import {
  IndicatorStateManager,
  requiredWarmupBars,
} from "../src/engine/indicatorStateManager";
import { discoverIndicators } from "../src/nodes/executors/InitializeIndicatorsExecutor";
import { IndicatorService } from "../src/nodes/logic/indicators";
import { TOOL_DEFINITIONS } from "../src/nodes/logic/toolDefinitions";
import type { WorkflowEdge, WorkflowNode } from "../src/nodes/types";

const bars = [
  { time: 1, high: 10, low: 8, close: 9 },
  { time: 2, high: 12, low: 9, close: 11 },
  { time: 3, high: 13, low: 10, close: 10.5 },
  { time: 4, high: 12, low: 7, close: 8 },
];

const smoothingBars = [
  { time: 1, high: 10, low: 8, close: 9 },
  { time: 2, high: 12, low: 9, close: 11 },
  { time: 3, high: 15, low: 11, close: 14 },
  { time: 4, high: 24, low: 14, close: 20 },
  { time: 5, high: 21, low: 19, close: 20 },
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

  it.each([
    ["wilders", [3, 16 / 3, 38 / 9]],
    ["simple", [3, 17 / 3, 16 / 3]],
  ] as const)(
    "calculates %s smoothing in batch and incremental engines",
    async (smoothing, expected) => {
      const updater = IndicatorService.createIncrementalUpdater("atr", {
        period: 3,
        smoothing,
      });
      let state = updater.warmUp([]).internalState;
      const incrementalValues = smoothingBars.map((bar) => {
        const result = updater.update(state, bar);
        state = result.internalState;
        return result.value;
      });
      const warmup = updater.warmUp(smoothingBars);
      const batch = await IndicatorService.calculateATR({
        candle_data: smoothingBars,
        period: 3,
        smoothing,
      });

      expected.forEach((value, index) => {
        expect(batch.data?.[index + 2]).toBeCloseTo(value, 9);
        expect(incrementalValues[index + 2]).toBeCloseTo(value, 9);
      });
      expect(warmup.value).toBeCloseTo(expected[2], 9);
      expect(warmup.internalState.smoothing).toBe(smoothing);
      expect(batch.meta?.smoothing).toBe(smoothing);
    },
  );

  it("defaults to Wilder and accepts documented aliases", async () => {
    const implicit = await IndicatorService.calculateATR({
      candle_data: smoothingBars,
      period: 3,
    });
    const explicit = await IndicatorService.calculateATR({
      candle_data: smoothingBars,
      period: 3,
      smoothing: "wilders",
    });
    expect(implicit.data).toEqual(explicit.data);
    expect(implicit.meta?.smoothing).toBe("wilders");

    const wilderAlias = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
      smoothing_method: " WILDER ",
    }).warmUp(smoothingBars);
    const simpleAlias = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
      moving_average_type: "SMA",
    }).warmUp(smoothingBars);
    expect(wilderAlias.value).toBeCloseTo(38 / 9, 9);
    expect(simpleAlias.value).toBeCloseTo(16 / 3, 9);
  });

  it("exposes canonical smoothing choices to the AI tool schema", () => {
    const schema = TOOL_DEFINITIONS.ATR.schema;
    expect(schema).toBeDefined();
    expect(schema?.parse({ period: 14 })).toMatchObject({
      period: 14,
      smoothing: "wilders",
    });
    expect(schema?.parse({ period: 14, smoothing: "simple" })).toMatchObject({
      period: 14,
      smoothing: "simple",
    });
    expect(() =>
      schema?.parse({ period: 14, smoothing: "exponential" }),
    ).toThrow();
  });

  it("rejects unknown smoothing instead of silently falling back", async () => {
    expect(() =>
      IndicatorService.createIncrementalUpdater("atr", {
        period: 3,
        smoothing: "exponential",
      }),
    ).toThrow("smoothing must be one of");
    const batch = await IndicatorService.calculateATR({
      candle_data: smoothingBars,
      period: 3,
      smoothing: "exponential",
    });
    expect(batch.success).toBe(false);
    expect(batch.error).toContain("smoothing must be one of");
  });

  it("keeps Simple state bounded and leaves it unchanged for invalid bars", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
      smoothing: "simple",
    });
    const generatedBars = Array.from({ length: 200 }, (_, index) => ({
      high: index + 3,
      low: index + 1,
      close: index + 2,
    }));
    const warmed = updater.warmUp(generatedBars);
    expect(warmed.internalState.trWindow).toHaveLength(3);
    const before = structuredClone(warmed.internalState);
    const invalid = updater.update(warmed.internalState, {
      high: NaN,
      low: 1,
      close: 1,
    });
    expect(invalid.internalState).toEqual(before);
    expect(invalid.value).toBe(before.lastValue);
  });

  it("drops an expired large True Range from the Simple window", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
      smoothing: "simple",
    });
    const initial = updater.warmUp(smoothingBars);
    const withLargeRange = updater.update(initial.internalState, {
      high: 22,
      low: 20,
      close: 21,
    });
    const expiredLargeRange = updater.update(withLargeRange.internalState, {
      high: 23,
      low: 21,
      close: 22,
    });

    expect(withLargeRange.value).toBeCloseTo(14 / 3, 9);
    expect(expiredLargeRange.value).toBeCloseTo(2, 9);
    expect(expiredLargeRange.internalState.trWindow).toEqual([2, 2, 2]);
  });

  it("migrates legacy persisted state to Wilder before continuing", () => {
    const updater = IndicatorService.createIncrementalUpdater("atr", {
      period: 3,
      smoothing: "wilders",
    });
    const legacyState = updater.warmUp(smoothingBars.slice(0, 3)).internalState;
    delete legacyState.smoothing;
    delete legacyState.trWindow;

    const updated = updater.update(legacyState, smoothingBars[3]);
    expect(updated.value).toBeCloseTo(16 / 3, 9);
    expect(updated.internalState).toMatchObject({
      smoothing: "wilders",
      trWindow: [],
    });
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

  it.each(["wilders", "simple"] as const)(
    "keeps %s batch, full warm-up, split warm-up, and update paths identical",
    async (smoothing) => {
      const updater = IndicatorService.createIncrementalUpdater("atr", {
        period: 3,
        smoothing,
      });
      const full = updater.warmUp(smoothingBars);
      const partial = updater.warmUp(smoothingBars.slice(0, -1));
      const incremental = updater.update(
        partial.internalState,
        smoothingBars.at(-1),
      );
      const batch = await IndicatorService.calculateATR({
        candle_data: smoothingBars,
        period: 3,
        smoothing,
      });

      expect(batch.data?.slice(0, 2)).toEqual([null, null]);
      expect(batch.data?.at(-1)).toBe(full.value);
      expect(full.value).toBe(incremental.value);
      expect(full.internalState).toEqual(incremental.internalState);
    },
  );

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

  it.each(["wilders", "simple"] as const)(
    "uses period bars for %s readiness and keeps async/sync updates identical",
    async (smoothing) => {
      const asyncManager = new IndicatorStateManager();
      const syncManager = new IndicatorStateManager();
      const initialAsync = await asyncManager.warmUp(
        "async",
        "atr",
        { period: 3, smoothing },
        bars.slice(0, 3),
        true,
      );
      const initialSync = await syncManager.warmUp(
        "sync",
        "atr",
        { period: 3, smoothing },
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

  it("keeps Wilder and Simple state independent", async () => {
    const manager = new IndicatorStateManager();
    const wilders = await manager.warmUp(
      "atr-wilders",
      "atr",
      { period: 3, smoothing: "wilders" },
      smoothingBars,
      true,
    );
    const simple = await manager.warmUp(
      "atr-simple",
      "atr",
      { period: 3, smoothing: "simple" },
      smoothingBars,
      true,
    );

    expect(wilders.currentValue).toBeCloseTo(38 / 9, 9);
    expect(simple.currentValue).toBeCloseTo(16 / 3, 9);
    expect(wilders.internalState.smoothing).toBe("wilders");
    expect(simple.internalState.smoothing).toBe("simple");
  });
});
