import { ComputeService } from "../src/nodes/logic/compute";

describe("ComputeService getIndex", () => {
  it("returns an element at a positive index", () => {
    const result = ComputeService.compute({
      value: ["first", "second", "third"],
      operator: "getIndex",
      arg1: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("second");
  });

  it("reads JSON array strings and supports negative indexes", () => {
    const result = ComputeService.compute({
      value: '["first", "last"]',
      operator: "getIndex",
      arg1: "-1",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("last");
  });

  it.each([
    { value: ["first", "second", "third"], arg1: 3 },
    { value: ["first", "second", "third"], arg1: -4 },
    { value: [], arg1: 0 },
  ])("returns null for an out-of-range index", ({ value, arg1 }) => {
    const result = ComputeService.compute({
      value,
      operator: "getIndex",
      arg1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
    "not-a-number",
    false,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    "2.5",
  ])(
    "rejects invalid index %p",
    (arg1) => {
      const result = ComputeService.compute({
        value: ["first", "second", "third"],
        operator: "getIndex",
        arg1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Index is required and must be an integer");
    },
  );
});
