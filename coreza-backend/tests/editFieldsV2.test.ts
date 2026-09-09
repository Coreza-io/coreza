import {
  applyFieldRows,
  coerceFixedValue,
} from "../src/nodes/logic/editFields";
describe("Edit Fields v2", () => {
  test("coerces fixed values without truthiness coercion", () => {
    expect(coerceFixedValue("42", "number")).toBe(42);
    expect(coerceFixedValue("false", "boolean")).toBe(false);
    expect(coerceFixedValue("[1,2]", "array")).toEqual([1, 2]);
    expect(coerceFixedValue('{"ok":true}', "object")).toEqual({ ok: true });
    expect(() => coerceFixedValue("", "number")).toThrow("expected Number");
    expect(() => coerceFixedValue("abc", "number")).toThrow("expected Number");
  });

  test("evaluates expressions and enforces the selected type", () => {
    const rows = [
      {
        fieldName: "risk",
        dataType: "number" as const,
        valueMode: "expression" as const,
        value: "$json.close - $nodes.atr.json.value * 2",
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
      applyFieldRows([{ ...rows[0], value: "'abc'" }], {
        input: {},
        legacyResultSeed: {},
      }),
    ).toThrow(
      'Edit Fields: field "risk" expected Number, but expression returned String ("abc")',
    );
    expect(() =>
      applyFieldRows([{ ...rows[0], value: "$json.missing" }], {
        input: {},
        legacyResultSeed: {},
      }),
    ).toThrow("Undefined");
  });

  test("writes persistent v2 values through and preserves mixed legacy behavior", () => {
    const persisted: Array<[string, unknown]> = [];
    const setPersistentValue = (key: string, value: unknown) => {
      persisted.push([key, value]);
    };
    const result = applyFieldRows(
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
          value: "$state.typed === false",
        },
        { left: "copy", operator: "copy", right: "old" },
        { left: "old", operator: "remove" },
      ],
      {
        input: {},
        legacyResultSeed: {},
        context: { persistent: true, setPersistentValue },
      },
    );
    expect(result).toEqual({ typed: false, readBack: true, copy: 2 });
    expect(persisted).toContainEqual(["typed", false]);
  });

  test("reads a persistent snapshot without permitting expression writes", () => {
    const reads: string[] = [];
    const getPersistentValue = (key: string) => {
      reads.push(key);
      return key === "last_high" ? 100 : undefined;
    };
    const result = applyFieldRows(
      [
        {
          fieldName: "breakout",
          dataType: "boolean",
          valueMode: "expression",
          value: "$json.close > $state.last_high",
        },
      ],
      {
        input: { close: 110 },
        legacyResultSeed: {},
        context: { getPersistentValue },
      },
    );
    expect(result).toEqual({ close: 110, breakout: true });
    expect(reads).toContain("last_high");
  });

  test("gives v2 rows the same result regardless of the legacy seed", () => {
    const rows = [
      {
        fieldName: "risk",
        dataType: "number" as const,
        valueMode: "expression" as const,
        value: "$json.close - 2",
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
});
