import {
  applyFieldRows,
  coerceFixedValue,
  EditFieldError,
} from "../src/nodes/logic/editFields";
import { ComputeService } from "../src/nodes/logic/compute";
describe("Edit Fields v2", () => {
  test("coerces fixed values without truthiness coercion", () => {
    expect(coerceFixedValue("42", "number")).toBe(42);
    expect(coerceFixedValue("false", "boolean")).toBe(false);
    expect(coerceFixedValue("[1,2]", "array")).toEqual([1, 2]);
    expect(coerceFixedValue('{"ok":true}', "object")).toEqual({ ok: true });
    expect(() => coerceFixedValue("", "number")).toThrow("expected Number");
    expect(() => coerceFixedValue("abc", "number")).toThrow("expected Number");
    expect(() => coerceFixedValue(null, "number")).toThrow("expected Number");
    expect(() => coerceFixedValue(false, "number")).toThrow("expected Number");
    expect(() => coerceFixedValue({}, "number")).toThrow("expected Number");
  });

  test("evaluates expressions and enforces the selected type", () => {
    const rows = [
      {
        fieldName: "risk",
        dataType: "number" as const,
        valueMode: "expression" as const,
        value: "{{ $json.close - $nodes.atr.json.value * 2 }}",
      },
    ];
    expect(
      applyFieldRows(rows, {
        input: { close: 10 },
        legacyResultSeed: {},
        context: { $nodes: { atr: { json: { value: 2 } } } },
      }),
    ).toEqual({ close: 10, risk: 6 });
    expect(() =>
      applyFieldRows([{ ...rows[0], value: "{{ 'abc' }}" }], {
        input: {},
        legacyResultSeed: {},
      }),
    ).toThrow(
      'Edit Fields: field "risk" expected Number, but expression returned String ("abc")',
    );
    expect(() =>
      applyFieldRows([{ ...rows[0], value: "{{ $json.missing }}" }], {
        input: {},
        legacyResultSeed: {},
      }),
    ).toThrow("Undefined");
  });

  test("produces typed arrays from expressions for downstream Compute nodes", () => {
    const rows = [
      {
        fieldName: "ranges",
        dataType: "array" as const,
        valueMode: "expression" as const,
        value: `{{ [
          $("getimpulseHigh").json.value - $("bars").json.bars[-1].Low,
          $("bars").json.bars[-1].High - $("getimpulseHigh").json.value
        ] }}`,
      },
    ];
    const result = applyFieldRows(rows, {
      input: {},
      legacyResultSeed: {},
      context: {
        $nodes: {
          getimpulseHigh: { json: { value: 100 } },
          bars: { json: { bars: [{ Low: 74, High: 126 }] } },
        },
      },
    });

    expect(result.ranges).toEqual([26, 26]);
    expect(
      ComputeService.compute({ value: result.ranges, operator: "max" }),
    ).toMatchObject({ success: true, data: 26 });
    expect(() =>
      applyFieldRows(
        [
          {
            ...rows[0],
            dataType: "string" as const,
            value: "{{ [1, 2] }}",
          },
        ],
        { input: {}, legacyResultSeed: {} },
      ),
    ).toThrow('field "ranges" expected String');
  });

  test("accepts empty and populated array literals for Array fields", () => {
    expect(
      applyFieldRows(
        [
          {
            fieldName: "empty",
            dataType: "array",
            valueMode: "expression",
            value: "{{ [] }}",
          },
          {
            fieldName: "values",
            dataType: "array",
            valueMode: "expression",
            value: "{{ [1, 2] }}",
          },
        ],
        { input: {}, legacyResultSeed: {} },
      ),
    ).toEqual({ empty: [], values: [1, 2] });
  });

  test("persists typed fixed and expression values through the existing state callbacks", () => {
    const state: Record<string, unknown> = {};
    const setPersistentValue = jest.fn((key: string, value: unknown) => { state[key] = value; });
    const context = { persistent: true, getPersistentValue: (key: string) => state[key], setPersistentValue };
    const rows: Array<{ fieldName: string; dataType: "boolean" | "number"; valueMode: "fixed" | "expression"; value: string }> = [
      { fieldName: "enabled", dataType: "boolean", valueMode: "fixed", value: "false" },
      { fieldName: "amount", dataType: "number", valueMode: "expression", value: "{{ $json.amount }}" },
    ];
    expect(applyFieldRows(rows, { input: { amount: 5 }, legacyResultSeed: {}, legacyPersistentRead: true, context }))
      .toMatchObject({ enabled: false, amount: 5 });
    expect(state).toEqual({ enabled: false, amount: 5 });
    expect(applyFieldRows(rows, { input: { amount: 10 }, legacyResultSeed: {}, legacyPersistentRead: true, context }))
      .toMatchObject({ enabled: false, amount: 10 });
    expect(setPersistentValue).toHaveBeenCalledTimes(4);
    expect(state.amount).toBe(10);
  });

  test("persistent typed manual execution still works without runner state callbacks", () => {
    expect(applyFieldRows([
      { fieldName: "amount", dataType: "number", valueMode: "fixed", value: "5" },
    ], { input: {}, legacyResultSeed: {}, context: { persistent: true } })).toEqual({ amount: 5 });
  });

  test("uses one input snapshot and applies duplicate fields in row order", () => {
    const result = applyFieldRows(
      [
        {
          fieldName: "close",
          dataType: "number",
          valueMode: "fixed",
          value: "200",
        },
        {
          fieldName: "breakout",
          dataType: "boolean",
          valueMode: "expression",
          value: "{{ $json.close === 110 }}",
        },
        {
          fieldName: "close",
          dataType: "number",
          valueMode: "fixed",
          value: "300",
        },
      ],
      {
        input: { close: 110 },
        legacyResultSeed: {},
      },
    );
    expect(result).toEqual({ close: 300, breakout: true });
  });

  test("reports structured row and type error details", () => {
    try {
      applyFieldRows(
        [
          {
            fieldName: "enabled",
            dataType: "boolean",
            valueMode: "expression",
            value: "{{ 1 }}",
          },
        ],
        { input: {}, legacyResultSeed: {}, nodeId: "field-1" },
      );
      throw new Error("expected evaluation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EditFieldError);
      expect((error as EditFieldError).details).toEqual({
        nodeId: "field-1",
        rowIndex: 0,
        fieldName: "enabled",
        phase: "type",
        expected: "Boolean",
        actual: "Number",
      });
    }
  });

  test("gives v2 rows the same result regardless of the legacy seed", () => {
    const rows = [
      {
        fieldName: "risk",
        dataType: "number" as const,
        valueMode: "expression" as const,
        value: "{{ $json.close - 2 }}",
      },
    ];
    const executorResult = applyFieldRows(rows, {
      input: { close: 10 },
      legacyResultSeed: {},
    });
    const routeResult = applyFieldRows(rows, {
      input: { close: 10 },
      legacyResultSeed: { close: 10 },
    });
    expect(executorResult).toEqual(routeResult);
  });

  test("rejects malformed typed rows and dangerous destinations before writes", () => {
    const persisted: Array<[string, unknown]> = [];
    expect(() =>
      applyFieldRows(
        [
          { left: "safe", operator: "set", right: 1 },
          {
            fieldName: "bad",
            dataType: "decimal",
            valueMode: "fixed",
            value: "2",
          } as never,
        ],
        {
          input: {},
          legacyResultSeed: {},
          context: {
            persistent: true,
            setPersistentValue: (key, value) => persisted.push([key, value]),
          },
        },
      ),
    ).toThrow("invalid typed row configuration");
    expect(persisted).toEqual([]);

    expect(() =>
      applyFieldRows(
        [
          { left: "safe", operator: "set", right: 1 },
          { left: "broken", operator: "unknown", right: 2 } as never,
        ],
        {
          input: {},
          legacyResultSeed: {},
          context: {
            persistent: true,
            setPersistentValue: (key, value) => persisted.push([key, value]),
          },
        },
      ),
    ).toThrow("invalid legacy row configuration");
    expect(persisted).toEqual([]);

    for (const fieldName of ["__proto__", "prototype", "constructor"]) {
      expect(() =>
        applyFieldRows([{ left: fieldName, operator: "set", right: 1 }], {
          input: {},
          legacyResultSeed: {},
        }),
      ).toThrow("is not allowed");
    }
  });
});
