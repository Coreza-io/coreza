import {
  EditorConsolidatorStateError,
  EditorConsolidatorStateService,
  type EditorConsolidatorIdentity,
  type EditorConsolidatorStateClient,
} from "../coreza-backend/src/engine/consolidation/EditorConsolidatorStateService";

class MemoryStateClient implements EditorConsolidatorStateClient {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _expiryMode: "PX",
    _expiry: number,
    _setMode: "NX",
  ): Promise<"OK" | null> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async setex(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string,
    token: string,
  ): Promise<number> {
    if (this.values.get(key) !== token) return 0;
    this.values.delete(key);
    return 1;
  }
}

const identity: EditorConsolidatorIdentity = {
  userId: "user-1",
  workflowId: "11111111-1111-4111-8111-111111111111",
  workflowSessionId: "22222222-2222-4222-8222-222222222222",
  nodeId: "consolidator-1",
  configFingerprint: "SPY-1h-4h-UTC",
};

const parameters = {
  symbol: "SPY",
  sourceTimeframe: "1h",
  targetTimeframe: "4h",
  timezone: "UTC",
  anchorTime: "",
};

const bar = (hour: number, close = hour + 1) => ({
  timestamp: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

const operationId = (digit: number) =>
  `${digit}`.repeat(8) +
  `-${digit}`.repeat(4) +
  `-4${digit}`.repeat(3) +
  `-8${digit}`.repeat(3) +
  `-${digit}`.repeat(12);

describe("EditorConsolidatorStateService", () => {
  it("starts without a DataContext and holds one working candle", async () => {
    const service = new EditorConsolidatorStateService(new MemoryStateClient());
    const result = await service.execute({
      identity,
      operationId: operationId(1),
      seriesAction: "start",
      sourceProvenance: { sourceNodeId: "onbar-1" },
      parameters,
      candleData: bar(0),
    });

    expect(result).toMatchObject({
      emitted: false,
      bar: null,
      workingBar: { open: 1, volume: 1 },
    });
  });

  it("replays one operation idempotently and rejects conflicting reuse", async () => {
    const service = new EditorConsolidatorStateService(new MemoryStateClient());
    const request = {
      identity,
      operationId: operationId(2),
      seriesAction: "start" as const,
      sourceProvenance: { sourceNodeId: "onbar-1" },
      parameters,
      candleData: bar(0),
    };
    const first = await service.execute(request);
    await expect(service.execute(request)).resolves.toEqual(first);
    await expect(
      service.execute({ ...request, candleData: bar(1) }),
    ).rejects.toMatchObject<Partial<EditorConsolidatorStateError>>({
      code: "DUPLICATE_OPERATION_CONFLICT",
    });
  });

  it("does not silently recreate an expired continuation", async () => {
    const service = new EditorConsolidatorStateService(new MemoryStateClient());
    await expect(
      service.execute({
        identity,
        operationId: operationId(3),
        seriesAction: "continue",
        sourceProvenance: { sourceNodeId: "onbar-1" },
        parameters,
        candleData: bar(1),
      }),
    ).rejects.toMatchObject<Partial<EditorConsolidatorStateError>>({
      code: "EDITOR_CONTEXT_EXPIRED",
    });
  });
});
