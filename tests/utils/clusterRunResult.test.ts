import { resolveClusterRunResult } from "@/utils/clusterRunResult";

describe("cluster terminal result contract", () => {
  it("keeps a non-final terminal observation pollable", () => {
    expect(resolveClusterRunResult({ resultFinalized: false }, ["node"], "run")).toEqual({
      finalized: false,
      outputs: new Map(),
    });
  });

  it("distinguishes executed, skipped, cancelled and not-executed members", () => {
    const resolution = resolveClusterRunResult({
      resultFinalized: true,
      nodeResults: { executed: 0 },
      nodeOutcomes: {
        executed: "executed",
        skipped: "skipped",
        cancelled: "cancelled",
        omitted: "not-executed",
      },
      executionOrder: ["executed"],
    }, ["executed", "skipped", "cancelled", "omitted"], "run");

    expect(resolution.warning).toBeUndefined();
    expect(resolution.outputs.get("executed")?.data).toBe(0);
    expect(resolution.outputs.get("skipped")?.status).toBe("skipped");
    expect(resolution.outputs.get("cancelled")?.status).toBe("cancelled");
    expect(resolution.outputs.get("omitted")?.status).toBe("not-executed");
  });

  it("hydrates valid siblings while preserving authority for malformed members", () => {
    const resolution = resolveClusterRunResult({
      resultFinalized: true,
      nodeResults: { valid: false },
      nodeOutcomes: { valid: "executed", malformed: "executed" },
    }, ["valid", "malformed"], "run");

    expect(resolution.outputs.get("valid")?.data).toBe(false);
    expect(resolution.outputs.has("malformed")).toBe(false);
    expect(resolution.warning).toMatch(/unavailable/i);
  });

  it.each([undefined, null, {}, { resultFinalized: true, nodeResults: {} }])(
    "makes a missing or malformed envelope retryable without fabricating output",
    (result) => {
      const resolution = resolveClusterRunResult(result, ["node"], "run");
      expect(resolution.finalized).toBe(true);
      expect(resolution.outputs.size).toBe(0);
      expect(resolution.warning).toMatch(/unavailable/i);
    },
  );
});
