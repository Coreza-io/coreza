import express from "express";
import request from "supertest";
import comparatorRoutes from "../src/routes/comparator";
import { applyFieldRows } from "../src/nodes/logic/editFields";

jest.mock("../src/middleware/jwtAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void): void => next(),
}));

const app = express().use(express.json()).use("/comparator", comparatorRoutes);

describe("POST /comparator/field", () => {
  test("evaluates the same selected input as direct workflow execution", async () => {
    const fields = [
      {
        fieldName: "breakout",
        dataType: "boolean" as const,
        valueMode: "expression" as const,
        value: "{{ close > 100 && $('window').json.previousHigh === 105 }}",
      },
    ];
    const data = { close: 110 };
    const nodeResults = { window: { json: { previousHigh: 105 } } };
    const expected = applyFieldRows(fields, {
      input: data,
      legacyResultSeed: data,
      context: {
        $nodes: nodeResults,
        nodes: [{ id: "window", name: "window" }],
      },
    });

    const response = await request(app)
      .post("/comparator/field")
      .send({
        fields,
        data,
        expressionContext: {
          nodeResults,
          nodeIdentities: [{ id: "window", name: "window" }],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expected);
    expect(response.body.data.breakout).toBe(true);
  });

  test("returns a structured error without applying an earlier legacy row", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const response = await request(app)
      .post("/comparator/field")
      .send({
        fields: [
          { left: "signal", operator: "set", right: true },
          {
            fieldName: "invalid",
            dataType: "decimal",
            valueMode: "fixed",
            value: "1",
          },
        ],
        data: { signal: false },
      });

    expect(response.status).toBe(500);
    expect(response.body.details).toMatchObject({
      code: "EDIT_FIELD_ERROR",
      rowIndex: 1,
      fieldName: "invalid",
      phase: "configuration",
    });
    consoleError.mockRestore();
  });
});
