import { IndicatorsExecutor } from "../src/nodes/executors/IndicatorsExecutor";
import { WorkflowNode } from "../src/nodes/types";
import express from "express";
import request from "supertest";
import storageRoutes from "../src/routes/storage";
import { seedRollingWindows } from "../src/backtest/rollingWindowSeed";
import { DataContextManager } from "../src/engine/DataContext";

jest.mock("../src/engine", () => ({}));
jest.mock("../src/middleware/jwtAuth", () => ({
  requireAuth: (
    req: { user?: { id: string } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: "user-1" };
    next();
  },
}));

class TestDataContext {
  private readonly data = new Map<string, unknown>();

  getDataByKey(key: string): unknown {
    return this.data.get(key);
  }

  setData(key: string, value: unknown): void {
    this.data.set(key, value);
  }
}

describe("Rolling Window operations", () => {
  const node: WorkflowNode = {
    id: "rolling-node",
    name: "RollingWindow",
    node_type: "RollingWindow",
    category: "Indicators",
    values: {},
  };

  const createContext = (runId: string) => ({
    userId: "user-1",
    workflowId: "workflow-1",
    runId,
    dataContext: new TestDataContext(),
  });

  const storageApp = express()
    .use(express.json())
    .use("/storage", storageRoutes);

  it("gets a requested timeframe without mutating its window", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-1");

    executor.execute(
      node,
      {
        operation: "set",
        size: 2,
        symbol: "BTCUSDT",
        timeframe: "1h",
        candle_data: [{ close: 1 }],
      },
      context,
    );
    executor.execute(
      node,
      {
        operation: "set",
        size: 3,
        symbol: "BTCUSDT",
        timeframe: "4h",
        candle_data: [{ close: 4 }],
      },
      context,
    );

    const firstGet = executor.execute(
      node,
      { operation: "get", symbol: "btcusdt", timeframe: "4h" },
      context,
    );
    const secondGet = executor.execute(
      node,
      { operation: "get", symbol: "BTCUSDT", timeframe: "4h" },
      context,
    );

    expect(firstGet).toMatchObject({
      success: true,
      data: {
        window: [{ close: 4 }],
        count: 1,
        size: 3,
        isReady: false,
        remaining: 2,
        latest: { close: 4 },
        found: true,
      },
      meta: { timeframe: "4h" },
    });
    expect(secondGet).toMatchObject({ data: { count: 1 } });
    expect(firstGet).not.toBe(secondGet);
  });

  it("does not create data when a set has no bars", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-invalid-set");
    executor.execute(
      node,
      {
        size: 2,
        symbol: "BTCUSDT",
        timeframe: "1h",
        candle_data: [{ close: 1 }],
      },
      context,
    );

    expect(
      executor.execute(
        node,
        {
          operation: "set",
          size: 2,
          symbol: "BTCUSDT",
          timeframe: "4h",
          candle_data: [],
        },
        context,
      ),
    ).toMatchObject({ success: false });

    expect(
      executor.execute(
        node,
        { operation: "get", symbol: "BTCUSDT", timeframe: "4h" },
        context,
      ),
    ).toMatchObject({
      data: { found: false, window: [] },
      meta: { timeframe: "4h" },
    });

    expect(
      executor.execute(
        node,
        { operation: "get", symbol: "BTCUSDT", timeframe: "1h" },
        context,
      ),
    ).toMatchObject({ data: { found: true, window: [{ close: 1 }] } });
  });

  it("uses shared parsing errors and returns a snapshot payload on set", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-parser-contract");

    expect(
      executor.execute(
        node,
        {
          symbol: "BTCUSDT",
          timeframe: "1h",
          candle_data: "{{ upstream.data }}",
        },
        context,
      ),
    ).toMatchObject({
      success: false,
      error:
        "Candle data contains unresolved template references. Execute the upstream node first.",
    });

    const result = executor.execute(
      node,
      {
        size: 2,
        symbol: "BTCUSDT",
        timeframe: "1h",
        candle_data: '[{"close":1}]',
      },
      context,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        window: [{ close: 1 }],
        count: 1,
        size: 2,
        isReady: false,
        remaining: 1,
        latest: { close: 1 },
        found: true,
      },
    });

    if (result instanceof Promise) {
      throw new Error("RollingWindow execution unexpectedly became asynchronous");
    }
    const returnedWindow = result.data?.window;
    const storedWindow = context.dataContext.getDataByKey(
      "RollingWindow:userId:user-1:workflowId:workflow-1:executionId:run-parser-contract:BTCUSDT:1h",
    ) as { values(): readonly unknown[] };
    expect(returnedWindow).not.toBe(storedWindow.values());
  });

  it("returns an empty successful read and requires a symbol", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-2");

    expect(
      executor.execute(
        node,
        { operation: "get", symbol: "ETHUSDT", timeframe: "1h" },
        context,
      ),
    ).toMatchObject({
      success: true,
      data: {
        window: [],
        count: 0,
        size: 0,
        isReady: false,
        remaining: 0,
        latest: null,
        found: false,
      },
    });

    expect(executor.execute(node, { operation: "get" }, context)).toMatchObject(
      {
        success: false,
        error: "symbol is required for get operation",
      },
    );

    expect(
      executor.execute(node, { operation: "get", symbol: "ETHUSDT" }, context),
    ).toMatchObject({
      success: false,
      error: "timeframe is required for get operation",
    });
  });

  it("does not read windows from another execution", () => {
    const executor = new IndicatorsExecutor();
    const firstContext = createContext("run-3");
    executor.execute(
      node,
      {
        size: 2,
        symbol: "SOLUSDT",
        timeframe: "1m",
        candle_data: [{ close: 10 }],
      },
      firstContext,
    );

    const result = executor.execute(
      node,
      { operation: "get", symbol: "SOLUSDT", timeframe: "1m" },
      createContext("run-4"),
    );

    expect(result).toMatchObject({ data: { found: false, window: [] } });
  });

  it("reads a backtest-seeded window through the storage route execution key", async () => {
    const executionId = "shared-storage-run";
    seedRollingWindows({
      userId: "user-1",
      workflowId: "workflow-1",
      executionId,
      symbols: ["btcusdt"],
      interval: "1h",
      size: 2,
      warmupBarsBySymbol: new Map([
        ["btcusdt", [{ close: 1 }, { close: 2 }, { close: 3 }]],
      ]),
    });

    const response = await request(storageApp)
      .post("/storage/rolling-window")
      .send({
        operation: "get",
        executionId,
        workflowId: "workflow-1",
        symbol: "BTCUSDT",
        timeframe: "1h",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        found: true,
        window: [{ close: 2 }, { close: 3 }],
        count: 2,
        size: 2,
      },
    });
    DataContextManager.getInstance().destroyContext(executionId);
  });

  it("returns 404 without creating an unknown execution context", async () => {
    const executionId = "missing-storage-run";
    const manager = DataContextManager.getInstance();

    const response = await request(storageApp)
      .post("/storage/rolling-window")
      .send({
        operation: "get",
        executionId,
        workflowId: "workflow-1",
        symbol: "BTCUSDT",
        timeframe: "1h",
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: "Execution context not found or already completed",
    });
    expect(manager.hasContext(executionId)).toBe(false);
  });

  it("reads a legacy set window whose blank timeframe used the fallback", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-legacy-timeframe");

    executor.execute(
      node,
      {
        operation: "set",
        size: 2,
        symbol: "AAPL",
        timeframe: " ",
        candle_data: [{ close: 200 }],
      },
      context,
    );

    expect(
      executor.execute(
        { ...node, id: "legacy-get-node" },
        { operation: "get", symbol: "aapl", timeframe: "_" },
        context,
      ),
    ).toMatchObject({
      success: true,
      data: { found: true, window: [{ close: 200 }] },
      meta: { timeframe: "_" },
    });
  });

  it("reads a window written by a different node", () => {
    const executor = new IndicatorsExecutor();
    const context = createContext("run-cross-node");
    const getNode = { ...node, id: "rolling-get-node" };

    executor.execute(
      node,
      {
        operation: "set",
        size: 2,
        symbol: " amd ",
        timeframe: " 1d ",
        candle_data: [{ close: 150 }],
      },
      context,
    );

    expect(
      executor.execute(
        getNode,
        { operation: "get", symbol: "AMD", timeframe: "1d" },
        context,
      ),
    ).toMatchObject({
      success: true,
      data: { found: true, window: [{ close: 150 }] },
      meta: {
        key: "RollingWindow:userId:user-1:workflowId:workflow-1:executionId:run-cross-node:AMD:1d",
        timeframe: "1d",
      },
    });
  });
});
