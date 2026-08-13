import { DataContextManager } from "../src/engine/DataContext";
import { RollingWindow } from "../src/engine/RollingWindow";
import { buildExecutionScopedKey } from "../src/utils/executionKey";
import {
  resolveRollingWindowSeedSize,
  seedRollingWindows,
} from "../src/backtest/rollingWindowSeed";

describe("backtest rolling-window warmup", () => {
  afterEach(() => jest.restoreAllMocks());

  it("rejects conflicting set-node sizes", () => {
    expect(() =>
      resolveRollingWindowSeedSize([
        { nodeId: "first", params: { size: "10" } },
        { nodeId: "second", params: { size: "20" } },
      ]),
    ).toThrow(
      "Conflicting RollingWindow sizes (10, 20) for the same symbol/timeframe",
    );
  });

  it("rejects a rolling window whose configuration was not serialized", () => {
    expect(() =>
      resolveRollingWindowSeedSize([{ nodeId: "missing-values", params: {} }]),
    ).toThrow(
      "RollingWindow node missing-values has no configuration; re-save the workflow",
    );
  });

  it("uses the clamped default and warns for unresolved sizes", () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      resolveRollingWindowSeedSize([
        { nodeId: "templated", params: { size: "{{ config.size }}" } },
      ]),
    ).toBe(20);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("templated has a non-numeric Window Size"),
    );
  });

  it("returns no seed size for a get-only workflow", () => {
    expect(resolveRollingWindowSeedSize([])).toBeUndefined();
  });

  it("seeds only the newest bars and reports unique symbol/timeframe keys", () => {
    const executionId = "warmup-run";
    const userId = "user";
    const workflowId = "workflow";
    const seed = {
      userId,
      workflowId,
      executionId,
      symbols: ["aapl", "MSFT"],
      interval: "1d",
      size: 2,
      warmupBarsBySymbol: new Map([
        ["aapl", [{ close: 1 }, { close: 2 }, { close: 3 }]],
        ["MSFT", [{ close: 4 }, { close: 5 }]],
      ]),
    };
    const firstCount = seedRollingWindows(seed);
    const secondCount = seedRollingWindows(seed);

    const context = DataContextManager.getInstance().getContext({
      executionId,
      workflowId,
      userId,
    });
    const key = buildExecutionScopedKey({
      userId,
      workflowId,
      runId: executionId,
      scope: "rolling_window",
      parts: ["AAPL", "1d"],
    });
    const window = context.getDataByKey(key) as RollingWindow<{ close: number }>;

    expect(firstCount).toBe(2);
    expect(secondCount).toBe(2);
    expect(window.values()).toEqual([{ close: 2 }, { close: 3 }]);
    expect(window.isReady).toBe(true);
    DataContextManager.getInstance().destroyContext(executionId);
  });
});
