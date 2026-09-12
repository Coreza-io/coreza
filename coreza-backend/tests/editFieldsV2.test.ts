import {
  applyFieldRows,
  coerceFixedValue,
  EditFieldError,
} from "../src/nodes/logic/editFields";
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

  test("rejects typed persistence before any writes", () => {
    const persisted: Array<[string, unknown]> = [];
    const setPersistentValue = (key: string, value: unknown) => {
      persisted.push([key, value]);
    };
    expect(() =>
      applyFieldRows(
        [
          { left: "old", operator: "set", right: 2 },
          {
            fieldName: "typed",
            dataType: "boolean",
            valueMode: "fixed",
            value: "false",
          },
          {
            fieldName: "readBack",
            dataType: "boolean",
            valueMode: "expression",
            value: "{{ $state.typed === false }}",
          },
          { left: "copy", operator: "copy", right: "old" },
          { left: "old", operator: "remove" },
        ],
        {
          input: {},
          legacyResultSeed: {},
          context: { persistent: true, setPersistentValue },
        },
      ),
    ).toThrow("typed rows do not support persistence");
    expect(persisted).toEqual([]);
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
