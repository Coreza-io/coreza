import {
  createNotExecutedOutput,
  normalizePersistedNodeResult,
} from "@/utils/persistedNodeResult";

describe("normalizePersistedNodeResult", () => {
  it.each([0, false, "", null, [1, 2]])("preserves raw falsy and array output %#", (value) => {
    expect(normalizePersistedNodeResult(value)).toMatchObject({
      success: true,
      status: "success",
      data: value,
    });
  });

  it("does not wrap an already-standard output", () => {
    const output = { success: true as const, status: "success" as const, data: { value: 1 } };
    expect(normalizePersistedNodeResult(output)).toBe(output);
  });

  it("normalizes legacy failures, structured errors, skipped values and raw objects", () => {
    expect(normalizePersistedNodeResult({ success: false, data: 3, error: "bad" }))
      .toEqual({ success: false, status: "error", data: 3, error: "bad" });
    expect(normalizePersistedNodeResult({ status: "failed", error: { message: "broken" } }))
      .toEqual({ success: false, status: "error", error: "broken" });
    expect(normalizePersistedNodeResult({ status: "skipped", data: { reason: "branch" } }))
      .toEqual({ success: true, status: "skipped", data: { reason: "branch" } });
    expect(normalizePersistedNodeResult({ value: 1 })).toEqual({
      success: true,
      status: "success",
      data: { value: 1 },
    });
  });

  it("creates an authoritative not-executed marker", () => {
    expect(createNotExecutedOutput("run-1")).toMatchObject({
      success: false,
      status: "not-executed",
      error: "Not executed in this run",
      meta: { runId: "run-1" },
    });
  });
});
