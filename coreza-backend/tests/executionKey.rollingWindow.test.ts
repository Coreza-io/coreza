import { buildExecutionScopedKey } from "../src/utils/executionKey";

describe("rolling window execution keys", () => {
  it("includes the symbol and timeframe without node scope", () => {
    const baseConfig = {
      userId: "user-1",
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "node-1",
      scope: "rolling_window",
    };

    const hourlyKey = buildExecutionScopedKey({
      ...baseConfig,
      parts: ["BTCUSDT", "1h"],
    });
    const dailyKey = buildExecutionScopedKey({
      ...baseConfig,
      parts: ["BTCUSDT", "1d"],
    });

    expect(hourlyKey).toBe(
      "RollingWindow:userId:user-1:workflowId:workflow-1:executionId:run-1:BTCUSDT:1h",
    );
    expect(
      buildExecutionScopedKey({
        ...baseConfig,
        nodeId: "node-2",
        parts: ["BTCUSDT", "1h"],
      }),
    ).toBe(hourlyKey);
    expect(dailyKey).not.toBe(hourlyKey);
  });
});
