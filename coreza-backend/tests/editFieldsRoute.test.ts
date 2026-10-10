import express from "express";
import request from "supertest";
import comparatorRoutes from "../src/routes/comparator";
import { applyFieldRows } from "../src/nodes/logic/editFields";
import { prepareHelperTransport } from "../src/nodes/logic/helperTransport";
import { compileEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";

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

describe("typed lastN transport", () => {
  const field = { fieldName: "tail", valueMode: "expression", dataType: "array", value: '{{ lastN($("ATR").json.data.value, $("Length").json.data) }}' };
  test("preserves display aliases, envelopes and strict available results", async () => {
    const response = await request(app).post("/comparator/field").send({ fields: [field], data: { seed: true }, expressionContext: {
      nodeIdentities: [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }],
      helperResults: { atr: { output: { json: { data: { value: [1,2,3] } } } }, count: { json: { data: 2 } } },
    }});
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ seed: true, tail: [2,3] });
  });
  test("refuses legacy/static fallback and returns a structured availability diagnostic", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const response = await request(app).post("/comparator/field").send({ fields: [field], expressionContext: {
      nodeIdentities: [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }],
      nodeResults: { atr: { json: { data: { value: [99] } } }, count: { json: { data: 1 } } }, helperResults: {},
    }});
    expect(response.status).toBe(500); expect(response.body.details).toMatchObject({ phase: "reference", rowIndex: 0, fieldName: "tail" });
    spy.mockRestore();
  });
  test("re-evaluates the bounded manual snapshot without serializing an unrelated prefix", async () => {
    const source = [1n, 2, 3];
    const nodes = [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }];
    const packet = prepareHelperTransport(compileEditTemplate(field.value, TYPED_EXPRESSION_FEATURES), {
      $json: {}, nodes, helperOutputs: { atr: { output: { json: { data: { value: source } } } }, count: { json: { data: 1 } } },
    });
    const response = await request(app).post("/comparator/field").send({ fields: [field], data: { seed: true }, expressionContext: { nodeIdentities: nodes, helperContexts: { 0: packet } } });
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ seed: true, tail: [3] });
  });
  test("rejects packets for rows outside the submitted field list", async () => {
    const response = await request(app).post("/comparator/field").send({ fields: [field], expressionContext: { helperContexts: { 1: {} } } });
    expect(response.status).toBe(400);
  });
});
