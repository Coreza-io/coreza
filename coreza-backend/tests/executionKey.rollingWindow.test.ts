import { buildExecutionScopedKey } from "../src/utils/executionKey";

describe("rolling window execution keys", () => {
  it("include the node, symbol, and timeframe", () => {
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
      "rw:userId:user-1:workflowId:workflow-1:executionId:run-1:node-1:BTCUSDT:1h",
    );
    expect(dailyKey).not.toBe(hourlyKey);
  });
});
