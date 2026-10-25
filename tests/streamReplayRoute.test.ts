import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** Execute the actual router with isolated Redis/auth dependencies. */
function harness() {
  const handlers = new Map<string, Function>();
  const redis = {
    xread: jest.fn().mockResolvedValue(null),
    xrange: jest.fn().mockResolvedValue([]),
    xrevrange: jest.fn().mockResolvedValue([]),
    publish: jest.fn().mockResolvedValue(1),
  };
  const router = { use: jest.fn(), get: jest.fn(), post: (path: string, handler: Function) => handlers.set(path, handler) };
  const source = readFileSync(resolve(__dirname, "../coreza-backend/src/routes/stream.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports, console: { error: jest.fn(), log: jest.fn() },
    setTimeout: () => { throw new Error("Replay must not introduce per-event sleeps"); },
    require: (name: string) => {
      if (name === "express") return { Router: () => router };
      if (name === "../config/redis") return { getRedisCache: () => redis };
      if (name === "../infra/redisKeys") return { RedisKeys: { strategyStream: (user: string, workflow: string) => `${user}:${workflow}` } };
      return {};
    },
  });
  const invoke = async (body: Record<string, unknown> = {}, user: string | null = "user-1") => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    await handlers.get("/replay")!({ user: user ? { id: user } : undefined, body: {
      workflowId: "workflow-1", nodeId: "stream-1", afterEntryId: "100-0", delivery: "response", ...body,
    } }, res);
    return res;
  };
  return { redis, invoke };
}

const entry = (id: string, value = id) => [id, ["event", JSON.stringify({ source: "alpaca_crypto", data: { value } })]];

describe("stream replay response delivery", () => {
  it("returns a page without user-wide WebSocket publication or event delays", async () => {
    const h = harness();
    h.redis.xread.mockResolvedValueOnce([["user-1:workflow-1", [entry("100-1"), entry("100-2")]]]);
    const res = await h.invoke();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ replayed: 2, lastEntryId: "100-2", hasMore: false,
      events: [expect.objectContaining({ entryId: "100-1" }), expect.objectContaining({ entryId: "100-2" })] }));
    expect(h.redis.publish).not.toHaveBeenCalled();
    expect(h.redis.xread).toHaveBeenCalledWith("COUNT", 1000, "STREAMS", "user-1:workflow-1", "100-0");
  });

  it("advertises further pages at the bounded batch limit", async () => {
    const h = harness();
    h.redis.xread.mockResolvedValueOnce([["stream", Array.from({ length: 1000 }, (_, i) => entry(`100-${i + 1}`))]]);
    const res = await h.invoke();
    expect(res.json.mock.calls[0][0]).toMatchObject({ replayed: 1000, hasMore: true, lastEntryId: "100-1000" });
  });

  it("advances over malformed entries to avoid a stuck replay cursor", async () => {
    const h = harness();
    h.redis.xread.mockResolvedValueOnce([["stream", [["100-1", ["event", "invalid json"]], ["100-2", ["other", "value"]]]]]);
    const res = await h.invoke();
    expect(res.json.mock.calls[0][0]).toMatchObject({ replayed: 0, lastEntryId: "100-2", events: [] });
  });

  it.each(["next", "prev"])("returns one %s event and its directional boundary", async mode => {
    const h = harness();
    const method = mode === "next" ? h.redis.xrange : h.redis.xrevrange;
    method.mockResolvedValueOnce([entry("100-0"), entry(mode === "next" ? "100-1" : "99-1")]);
    const res = await h.invoke({ mode });
    expect(res.json.mock.calls[0][0]).toMatchObject({ replayed: 1, [mode === "next" ? "hasNext" : "hasPrevious"]: false });
    expect(res.json.mock.calls[0][0].events).toHaveLength(1);
    expect(h.redis.publish).not.toHaveBeenCalled();
  });

  it("preserves socket delivery for existing clients", async () => {
    const h = harness();
    h.redis.xread.mockResolvedValueOnce([["stream", [entry("100-1")]]]);
    await h.invoke({ delivery: "socket" });
    expect(h.redis.publish).toHaveBeenCalledTimes(1);
    expect(h.redis.publish.mock.calls[0][0]).toBe("ws:user:user-1");
  });

  it.each([{ mode: "bad" }, { delivery: "bad" }, { afterEntryId: "bad" }])("validates replay input %j", async body => {
    const h = harness();
    const res = await h.invoke(body);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(h.redis.xread).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const h = harness();
    const res = await h.invoke({}, null);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(h.redis.xread).not.toHaveBeenCalled();
  });
});
