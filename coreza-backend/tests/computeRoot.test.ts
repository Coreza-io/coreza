import express from "express";
import request from "supertest";
import { ComputeService } from "../src/nodes/logic/compute";
import { ControlFlowExecutor } from "../src/nodes/executors/ControlFlowExecutor";
import comparatorRoutes from "../src/routes/comparator";

jest.mock("../src/middleware/jwtAuth", () => ({
  requireAuth: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
}));

jest.mock("../src/nodes/executors/LoopExecutorV2", () => ({
  LoopExecutorV2: class {},
}));

const app = express()
  .use(express.json())
  .use("/comparator", comparatorRoutes);

function computeRoot(value: unknown, arg1?: unknown) {
  return ComputeService.compute({ value, operator: "root", arg1 });
}

function expectCloseToRelative(actual: unknown, expected: number): void {
  expect(typeof actual).toBe("number");
  if (typeof actual !== "number") {
    throw new Error("Expected root result to be a number");
  }

  const scale = Math.max(Math.abs(expected), Number.MIN_VALUE);
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(1e-12);
}

describe("ComputeService root", () => {
  it.each([
    [81, 2, 9],
    [27, 3, 3],
    [81, 4, 3],
    [32, 5, 2],
    [1024, 10, 2],
    [-27, 3, -3],
    [-32, 5, -2],
    [0.008, 3, 0.2],
  ])(
    "computes the principal real root of %p with degree %p",
    (value, degree, expected) => {
      const result = computeRoot(value, degree);

      expect(result.success).toBe(true);
      expect(typeof result.data).toBe("number");
      expectCloseToRelative(result.data, expected);
    },
  );

  it.each([
    [0, 7, 0],
    [-0, 7, 0],
    [49, 1, 49],
    [-49, 1, -49],
    [1, Number.MAX_SAFE_INTEGER, 1],
  ])(
    "returns exact boundary result for %p with degree %p",
    (value, degree, expected) => {
      const result = computeRoot(value, degree);

      expect(result.success).toBe(true);
      expect(result.data).toBe(expected);
      expect(Object.is(result.data, -0)).toBe(false);
    },
  );

  it.each([
    ["81", " 4 ", 3],
    ["1e-12", 2, 1e-6],
    [Number.MIN_VALUE, 2, Math.sqrt(Number.MIN_VALUE)],
    [Number.MAX_VALUE, 2, Math.sqrt(Number.MAX_VALUE)],
  ])(
    "accepts strict numeric input %p and degree %p",
    (value, degree, expected) => {
      const result = computeRoot(value, degree);

      expect(result.success).toBe(true);
      expectCloseToRelative(result.data, expected);
    },
  );

  it("rejects even roots of negative values", () => {
    const result = computeRoot(-16, 2);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Even roots of negative values have no real result",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
    false,
    1n,
    [],
    {},
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "{{ $json.amount }}",
  ])("rejects invalid value %p", (value) => {
    const result = computeRoot(value, 2);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Value must be a finite number");
  });

  it.each([undefined, "", "   "])("reports missing degree %p", (degree) => {
    const result = computeRoot(81, degree);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Root degree is required; use 2 for square root");
  });

  it.each([
    null,
    false,
    1n,
    [],
    {},
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "{{ $json.degree }}",
  ])("rejects invalid degree %p", (degree) => {
    const result = computeRoot(81, degree);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Root degree must be a positive safe integer");
  });

  it("uses fresh runtime values and degrees on every execution", () => {
    expect(computeRoot(81, 4).data).toBe(3);
    expect(computeRoot(32, 5).data).toBe(2);
  });

  it("does not change loose coercion in existing Number operations", () => {
    expect(ComputeService.compute({ value: null, operator: "abs" }).data).toBe(
      0,
    );
    expect(
      ComputeService.compute({ value: false, operator: "add", arg1: [] }).data,
    ).toBe(0);
  });

  it("leaves array standard deviation behavior unchanged", () => {
    const result = ComputeService.compute({ value: [2, 4], operator: "std" });

    expect(result.success).toBe(true);
    expect(result.data).toBe(1);
  });
});

describe("root integration", () => {
  it("returns a scalar root through the HTTP Compute route", async () => {
    const response = await request(app)
      .post("/comparator/compute")
      .send({ value: 81, operator: "root", arg1: 4 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      status: "success",
      data: 3,
    });
    expect(typeof response.body.data).toBe("number");
  });

  it("preserves root domain errors through the HTTP Compute route", async () => {
    const response = await request(app)
      .post("/comparator/compute")
      .send({ value: -16, operator: "root", arg1: 2 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Even roots of negative values have no real result",
    });
  });

  it("uses newly resolved value and degree on each workflow execution", () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: "compute-root",
      name: "Compute",
      node_type: "main",
      category: "Logic",
      values: {
        value: "{{ $json.amount }}",
        operator: "root",
        arg1: "{{ $json.degree }}",
      },
    };
    const resolveNodeParameters = jest
      .fn()
      .mockReturnValueOnce({ value: 81, operator: "root", arg1: 4 })
      .mockReturnValueOnce({ value: 32, operator: "root", arg1: 5 });

    const first = executor.execute(node, {}, { resolveNodeParameters });
    const second = executor.execute(node, {}, { resolveNodeParameters });

    expect(first).toMatchObject({ success: true, data: 3 });
    expect(second).toMatchObject({ success: true, data: 2 });
    expect(resolveNodeParameters).toHaveBeenNthCalledWith(1, node, {});
    expect(resolveNodeParameters).toHaveBeenNthCalledWith(2, node, {});
  });
});
