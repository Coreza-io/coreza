import express from "express";
import request from "supertest";
import { DataContextManager } from "../src/engine/DataContext";
import storageRoutes from "../src/routes/storage";

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

const app = express().use(express.json()).use("/storage", storageRoutes);
const manager = DataContextManager.getInstance();

const input = (hour: number, value: number) => ({
  timestamp: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`,
  open: value,
  high: value,
  low: value,
  close: value,
  volume: 1,
});

const body = (runId: string, hour: number, value: number) => ({
  runId,
  workflowId: "workflow-1",
  symbol: "SPY",
  source_timeframe: "1h",
  target_timeframe: "4h",
  candle_data: input(hour, value),
});

describe("POST /storage/consolidator", () => {
  const executionId = "consolidator-route-run";

  beforeEach(() => {
    manager.destroyContext(executionId);
    manager.getContext({
      executionId,
      workflowId: "workflow-1",
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
        data: { emitted: false, bar: null },
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
        emitted: true,
        bar: { open: 1, high: 4, low: 1, close: 4, volume: 4 },
        workingBar: { open: 5 },
      },
    });
  });

  it("returns a keyed 404 without creating a missing execution context", async () => {
    const missingId = "missing-consolidator-run";
    const response = await request(app)
      .post("/storage/consolidator")
      .send(body(missingId, 0, 1));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: "Execution context not found or already completed",
      meta: { key: "SPY:1h:4h:UTC:" },
    });
    expect(manager.hasContext(missingId)).toBe(false);
  });

  it("rejects requests that do not identify an execution context", async () => {
    const { runId: _runId, ...requestBody } = body(executionId, 0, 1);
    const response = await request(app)
      .post("/storage/consolidator")
      .send(requestBody);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "runId, workflowSessionId, or backtestId is required",
    });
  });

  it("uses the editor workflow session id as the execution context", async () => {
    const { runId: _runId, ...requestBody } = body(executionId, 0, 1);
    const response = await request(app)
      .post("/storage/consolidator")
      .send({ ...requestBody, workflowSessionId: executionId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { emitted: false },
      meta: { key: "SPY:1h:4h:UTC:" },
    });
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
