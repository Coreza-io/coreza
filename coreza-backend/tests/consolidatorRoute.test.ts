import express from "express";
import request from "supertest";
import { DataContextManager } from "../src/engine/DataContext";
import { buildConsolidatorConfigFingerprint } from "../src/engine/consolidation/consolidatorShared";
import storageRoutes from "../src/routes/storage";

jest.mock("../src/engine", () => ({}));
const redisValues = new Map<string, string>();
const redisMock = {
  set: jest.fn(async (key: string, value: string, ...args: string[]) => {
    if (args.includes("NX") && redisValues.has(key)) return null;
    redisValues.set(key, value);
    return "OK";
  }),
  get: jest.fn(async (key: string) => redisValues.get(key) ?? null),
  setex: jest.fn(async (key: string, _ttl: number, value: string) => {
    redisValues.set(key, value);
    return "OK";
  }),
  del: jest.fn(async (key: string) => Number(redisValues.delete(key))),
  eval: jest.fn(
    async (_script: string, _keys: number, key: string, token: string) => {
      if (redisValues.get(key) === token)
        return Number(redisValues.delete(key));
      return 0;
    },
  ),
};
jest.mock("../src/config/redis", () => ({ getRedisCache: () => redisMock }));
jest.mock("../src/config/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "workflow-1" },
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}));
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

const app = express().use(express.json()).use("/storage", storageRoutes);
const manager = DataContextManager.getInstance();
const workflowId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";

const input = (hour: number, value: number) => ({
  timestamp: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`,
  open: value,
  high: value,
  low: value,
  close: value,
  volume: 1,
});

const body = (runId: string, hour: number, value: number) => ({
  contextMode: "active-run",
  runId,
  workflowId,
  nodeId: "consolidator-1",
  symbol: "SPY",
  source_timeframe: "1h",
  target_timeframe: "4h",
  candle_data: input(hour, value),
});

const editorBody = (overrides: Record<string, unknown> = {}) => {
  const parameters = {
    symbol: "SPY",
    sourceTimeframe: "1h",
    targetTimeframe: "4h",
    timezone: "UTC",
    anchorTime: "",
  };
  return {
    contextMode: "editor",
    workflowId,
    workflowSessionId: sessionId,
    nodeId: "consolidator-1",
    configFingerprint: buildConsolidatorConfigFingerprint(parameters),
    operationId,
    seriesAction: "start",
    sourceProvenance: { sourceNodeId: "onbar-1", sourceRunId: runId },
    symbol: parameters.symbol,
    source_timeframe: parameters.sourceTimeframe,
    target_timeframe: parameters.targetTimeframe,
    timezone: parameters.timezone,
    anchor_time: parameters.anchorTime,
    candle_data: input(0, 1),
    ...overrides,
  };
};

describe("POST /storage/consolidator", () => {
  const executionId = runId;

  beforeEach(() => {
    redisValues.clear();
    manager.destroyContext(executionId);
    manager.getContext({
      executionId,
      workflowId,
      userId: "user-1",
    });
  });

  afterEach(() => manager.destroyContext(executionId));

  it("holds four source bars and emits the completed bucket on the fifth", async () => {
    for (let hour = 0; hour < 4; hour += 1) {
      const response = await request(app)
        .post("/storage/consolidator")
        .send(body(executionId, hour, hour + 1));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: { timeframe: "4h", emitted: false, bar: null },
        meta: { key: "SPY:1h:4h:UTC:" },
      });
      expect(response.body.data.workingBar).toBeDefined();
    }

    const response = await request(app)
      .post("/storage/consolidator")
      .send(body(executionId, 4, 5));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        timeframe: "4h",
        emitted: true,
        bar: { open: 1, high: 4, low: 1, close: 4, volume: 4 },
        workingBar: { open: 5 },
      },
    });
  });

  it("returns a keyed 404 without creating a missing execution context", async () => {
    const missingId = "55555555-5555-4555-8555-555555555555";
    const response = await request(app)
      .post("/storage/consolidator")
      .send(body(missingId, 0, 1));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      code: "EXECUTION_CONTEXT_COMPLETED",
      error: "Execution context not found or already completed",
      meta: { key: "SPY:1h:4h:UTC:" },
    });
    expect(manager.hasContext(missingId)).toBe(false);
  });

  it("rejects requests that do not identify an execution context", async () => {
    const {
      contextMode: _contextMode,
      runId: _runId,
      ...requestBody
    } = body(executionId, 0, 1);
    const response = await request(app)
      .post("/storage/consolidator")
      .send(requestBody);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      code: "INVALID_EXECUTION_CONTEXT",
      error: "contextMode must be editor or active-run",
    });
  });

  it("creates independent editor state for the first valid operation", async () => {
    const response = await request(app)
      .post("/storage/consolidator")
      .send({
        ...editorBody(),
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { timeframe: "4h", emitted: false },
      meta: { key: "SPY:1h:4h:UTC:" },
    });
    expect(manager.hasContext(sessionId)).toBe(false);
  });

  it("returns the same result when an editor operation is retried", async () => {
    const requestBody = editorBody();
    const first = await request(app)
      .post("/storage/consolidator")
      .send(requestBody);
    const retry = await request(app)
      .post("/storage/consolidator")
      .send(requestBody);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
  });

  it("rejects an operation id reused with a different candle", async () => {
    await request(app).post("/storage/consolidator").send(editorBody());
    const response = await request(app)
      .post("/storage/consolidator")
      .send(editorBody({ candle_data: input(1, 2) }));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "DUPLICATE_OPERATION_CONFLICT",
    });
  });

  it("reports an expired editor context instead of silently restarting", async () => {
    const response = await request(app)
      .post("/storage/consolidator")
      .send(editorBody({ seriesAction: "continue" }));

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      success: false,
      code: "EDITOR_CONTEXT_EXPIRED",
    });
  });

  it("isolates identical configurations by node id", async () => {
    const first = await request(app)
      .post("/storage/consolidator")
      .send(editorBody({ nodeId: "consolidator-1" }));
    const second = await request(app)
      .post("/storage/consolidator")
      .send(
        editorBody({
          nodeId: "consolidator-2",
          operationId: "66666666-6666-4666-8666-666666666666",
        }),
      );

    expect(first.body.data.workingBar.volume).toBe(1);
    expect(second.body.data.workingBar.volume).toBe(1);
  });

  it("returns the timeframe validation error", async () => {
    const response = await request(app)
      .post("/storage/consolidator")
      .send({
        ...body(executionId, 0, 1),
        source_timeframe: "3h",
        target_timeframe: "4h",
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining("exact multiple"),
    });
  });
});
