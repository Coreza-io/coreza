import express from "express";
import request from "supertest";
import comparatorRoutes from "../src/routes/comparator";
import { applyFieldRows } from "../src/nodes/logic/editFields";
import { prepareExpressionTransport } from "../src/nodes/logic/expressionTransport";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";
import { ControlFlowExecutor } from "../src/nodes/executors/ControlFlowExecutor";

jest.mock("../src/middleware/jwtAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void): void => next(),
}));
jest.mock("../src/nodes/executors/LoopExecutorV2", () => ({ LoopExecutorV2: class {} }));

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

describe("computed slice transport", () => {
  test.each([
    '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}',
    '{{ $("get_atr_history").json.data.value[-{{ $("short_len").json.data }}:] }}',
  ])("the expression agrees across preview, manual HTTP and workflow execution: %s", async value => {
    const fields = [{ fieldName: "var1", valueMode: "expression" as const, dataType: "array", value }];
    const nodes = [{ id: "get_atr_history" }, { id: "short_len" }];
    const outputs = {
      get_atr_history: { success: true, status: "success", data: { value: [1,2,3,4,5,6,7,8] } },
      short_len: { success: true, status: "success", data: 5 },
    };
    const context = { $json: {}, nodes, expressionOutputs: outputs };
    const compiled = compileEditTemplate(value, TYPED_EXPRESSION_FEATURES);
    expect(compiled.nodeReferences).toEqual(["get_atr_history", "short_len"]);
    const expected = [4,5,6,7,8];
    // Preview uses this same shared evaluator and the unchanged output envelopes.
    expect(evaluateEditTemplate(compiled, context)).toEqual(expected);
    const packet = prepareExpressionTransport(compiled, context);
    const response = await request(app).post("/comparator/field").send({ fields, data: {}, expressionContext: { nodeIdentities: nodes, expressionContexts: { 0: packet } } });
    expect(response.status).toBe(200);
    expect(response.body.data.var1).toEqual(expected);
    const executor = new ControlFlowExecutor();
    const node = { id: "edit", name: "Edit Fields", node_type: "main", category: "Logic", values: { fields } };
    expect(await executor.execute(node, {}, { nodes, getAllNodeResults: () => outputs })).toMatchObject({ success: true, data: { var1: expected } });
    // Later invocations must read the latest count, including zero selecting the whole array.
    outputs.short_len.data = 0;
    expect(await executor.execute(node, {}, { nodes, getAllNodeResults: () => outputs })).toMatchObject({ success: true, data: { var1: outputs.get_atr_history.data.value } });
    const zeroResponse = await request(app).post("/comparator/field").send({ fields, data: {}, expressionContext: { nodeIdentities: nodes, expressionContexts: { 0: prepareExpressionTransport(compiled, context) } } });
    expect(zeroResponse.status).toBe(200);
    expect(zeroResponse.body.data.var1).toEqual(outputs.get_atr_history.data.value);
  });
  const field = { fieldName: "tail", valueMode: "expression", dataType: "array", value: '{{ ($("ATR").json.data.value)[-($("Length").json.data + 0):] }}' };
  test("preserves display aliases, envelopes and strict available results", async () => {
    const response = await request(app).post("/comparator/field").send({ fields: [field], data: { seed: true }, expressionContext: {
      nodeIdentities: [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }],
      expressionResults: { atr: { output: { json: { data: { value: [1,2,3] } } } }, count: { json: { data: 2 } } },
    }});
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ seed: true, tail: [2,3] });
  });
  test("refuses legacy/static fallback and returns a structured availability diagnostic", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const response = await request(app).post("/comparator/field").send({ fields: [field], expressionContext: {
      nodeIdentities: [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }],
      nodeResults: { atr: { json: { data: { value: [99] } } }, count: { json: { data: 1 } } }, expressionResults: {},
    }});
    expect(response.status).toBe(500); expect(response.body.details).toMatchObject({ phase: "reference", rowIndex: 0, fieldName: "tail" });
    spy.mockRestore();
  });
  test("re-evaluates the bounded manual snapshot without serializing an unrelated prefix", async () => {
    const source = [1n, 2, 3];
    const nodes = [{ id: "atr", displayName: "ATR" }, { id: "count", displayName: "Length" }];
    const packet = prepareExpressionTransport(compileEditTemplate(field.value, TYPED_EXPRESSION_FEATURES), {
      $json: {}, nodes, expressionOutputs: { atr: { output: { json: { data: { value: source } } } }, count: { json: { data: 1 } } },
    });
    const response = await request(app).post("/comparator/field").send({ fields: [field], data: { seed: true }, expressionContext: { nodeIdentities: nodes, expressionContexts: { 0: packet } } });
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ seed: true, tail: [3] });
  });
  test("rejects packets for rows outside the submitted field list", async () => {
    const response = await request(app).post("/comparator/field").send({ fields: [field], expressionContext: { expressionContexts: { 1: {} } } });
    expect(response.status).toBe(400);
  });
});
