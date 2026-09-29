import { getControlResultHandle } from "@/utils/controlResult";

describe("control result decoding", () => {
  it.each([
    [true, "true"],
    [{ true: true, false: false }, "true"],
    [{ success: true, status: "success", data: { result: true } }, "true"],
    [{ data: { result: "case-a" } }, "case-a"],
  ])("decodes %p", (value, expected) => {
    expect(getControlResultHandle(value)).toBe(expected);
  });

  it("does not stringify arbitrary business objects", () => {
    expect(getControlResultHandle({ data: { symbol: "AAPL" } })).toBe("");
  });
});