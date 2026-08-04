import { ComputeService } from "../src/nodes/logic/compute";

describe("ComputeService extremeByValue", () => {
  const scores = { AAPL: 0.82, MSFT: 0.91, TSLA: 0.45 };

  it("returns the key with the maximum value by default", () => {
    const result = ComputeService.compute({
      value: scores,
      operator: "extremeByValue",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("MSFT");
  });

  it("returns the numeric minimum value from a JSON object string", () => {
    const result = ComputeService.compute({
      value: JSON.stringify(scores),
      operator: "extremeByValue",
      extremeDirection: "min",
      extremeReturn: "value",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe(0.45);
  });

  it("returns an entry and preserves the first key when values tie", () => {
    const result = ComputeService.compute({
      value: { first: "5", second: 5, lower: 1 },
      operator: "extremeByValue",
      extremeReturn: "entry",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ key: "first", value: 5 });
  });

  it("defaults unknown selections to maximum and key", () => {
    const result = ComputeService.compute({
      value: scores,
      operator: "extremeByValue",
      extremeDirection: "unknown",
      extremeReturn: "unknown",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("MSFT");
  });

  it("rejects an empty object", () => {
    const result = ComputeService.compute({
      value: {},
      operator: "extremeByValue",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Object cannot be empty");
  });

  it("rejects an object without finite-numeric values", () => {
    const result = ComputeService.compute({
      value: {
        missing: null,
        enabled: false,
        blank: " ",
        invalid: "not-a-number",
        infinite: Number.POSITIVE_INFINITY,
      },
      operator: "extremeByValue",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Object does not contain numeric values");
  });
});
