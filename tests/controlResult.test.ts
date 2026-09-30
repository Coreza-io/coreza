import { getControlResultHandle, resolveControlResult } from "@/utils/controlResult";

describe("control result decoding", () => {
  it.each([
    [true, "true"],
    [{ true: true, false: false }, "true"],
    [{ success: true, data: { true: false, false: true } }, "false"],
    [{ success: true, data: { true: true, false: false } }, "true"],
    [{ success: true, data: "case-a" }, "case-a"],
    [{ success: true, data: "fallback" }, "fallback"],
    [{ success: true, status: "success", data: { result: true } }, "true"],
    [{ data: { result: "case-a" } }, "case-a"],
  ])("decodes %p", (value, expected) => {
    expect(getControlResultHandle(value)).toBe(expected);
  });

  it("does not stringify arbitrary business objects", () => {
    expect(getControlResultHandle({ data: { symbol: "AAPL" } })).toBe("");
  });

  it("distinguishes a selected edge, an unconnected terminal, and malformed output", () => {
    const handles = new Set(["true"]);
    expect(resolveControlResult(true, handles)).toEqual({ kind: "selected", handle: "true" });
    expect(resolveControlResult("fallback", handles)).toEqual({ kind: "terminal", handle: "fallback" });
    expect(resolveControlResult({ data: { symbol: "AAPL" } }, handles)).toEqual({ kind: "malformed" });
  });
});
