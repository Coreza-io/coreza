const values = new Map<string, { value: string; expiresAt?: number }>();

function read(key: string): string | null {
  const entry = values.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    values.delete(key);
    return null;
  }
  return entry.value;
}

const redis = {
  set: jest.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    const nx = args.includes("NX");
    if (nx && read(key) !== null) return null;
    const exIndex = args.indexOf("EX");
    const ttl = exIndex >= 0 ? Number(args[exIndex + 1]) : undefined;
    values.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : undefined });
    return "OK";
  }),
  mget: jest.fn(async (...keys: string[]) => keys.map(read)),
  eval: jest.fn(async (script: string, keyCount: number, ...args: Array<string>) => {
    const keys = args.slice(0, keyCount);
    const argv = args.slice(keyCount);
    if (read(keys[0]) !== argv[0]) return 0;
    if (script.includes("for i = 2")) {
      for (const key of keys.slice(1)) {
        values.set(key, { value: argv[1], expiresAt: Date.now() + Number(argv[2]) * 1000 });
      }
    }
    values.delete(keys[0]);
    return 1;
  }),
};

jest.mock("../src/config/redis", () => ({ getRedisCache: () => redis }));

import {
  claimEmissionBatch,
  findDeliveredEmissionIds,
  markEmissionDelivered,
  releaseEmissionClaim,
} from "../src/engine/consolidation/consolidatorDeliveryReceipt";

describe("consolidator emission ownership", () => {
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    process.env.CONSOLIDATOR_CLAIM_LEASE_SECONDS = "120";
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.CONSOLIDATOR_CLAIM_LEASE_SECONDS;
  });

  it("allows only one worker to execute and atomically records one receipt", async () => {
    const ids = ["emission-b", "emission-a"];
    let executions = 0;
    const worker = async (token: string): Promise<void> => {
      if (!(await claimEmissionBatch("user", "workflow", "execution", ids, token))) return;
      executions += 1;
      expect(await markEmissionDelivered("user", "workflow", "execution", ids, token)).toBe(true);
    };

    await Promise.all([worker("runner-a:one"), worker("runner-b:two")]);

    expect(executions).toBe(1);
    expect(await findDeliveredEmissionIds("user", "execution", ids)).toEqual(new Set(ids));
  });

  it("reclaims an expired lease", async () => {
    const ids = ["emission"];
    expect(await claimEmissionBatch("user", "workflow", "execution", ids, "stale")).toBe(true);
    jest.advanceTimersByTime(120_001);
    expect(await claimEmissionBatch("user", "workflow", "execution", ids, "new-owner")).toBe(true);
  });

  it("does not let a stale token deliver or release another owner's claim", async () => {
    const ids = ["emission"];
    expect(await claimEmissionBatch("user", "workflow", "execution", ids, "stale")).toBe(true);
    jest.advanceTimersByTime(120_001);
    expect(await claimEmissionBatch("user", "workflow", "execution", ids, "current")).toBe(true);

    expect(await markEmissionDelivered("user", "workflow", "execution", ids, "stale")).toBe(false);
    expect(await releaseEmissionClaim("user", "workflow", "execution", ids, "stale")).toBe(false);
    expect(await markEmissionDelivered("user", "workflow", "execution", ids, "current")).toBe(true);
  });
});
