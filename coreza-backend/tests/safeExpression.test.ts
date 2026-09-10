import {
  evaluateExpression,
  ExpressionError,
} from "../src/nodes/logic/safeExpression";

const context = {
  $json: { close: 110, bars: [{ high: 105 }] },
  $nodes: { atr: { json: { value: 4 } } },
  $state: { last_high: 100 },
  nodes: [{ id: "atr", data: { displayName: "ATR" } }],
};

describe("safe expressions", () => {
  test("evaluates typed literals, precedence, references, and short circuiting", () => {
    expect(evaluateExpression("'coreza'", context)).toBe("coreza");
    expect(evaluateExpression("null", context)).toBeNull();
    expect(evaluateExpression("1 + 2 * 3", context)).toBe(7);
    expect(evaluateExpression("!(false || true) === false", context)).toBe(
      true,
    );
    expect(
      evaluateExpression(
        "$json.close > $state.last_high && $('ATR').json.value === 4",
        context,
      ),
    ).toBe(true);
    expect(evaluateExpression("$json.bars[0].high", context)).toBe(105);
    expect(evaluateExpression("$json.missing.path", context)).toBeUndefined();
    expect(evaluateExpression("false && $json.missing.value", context)).toBe(
      false,
    );
  });

  test.each([
    "process.env",
    "require('fs')",
    "globalThis",
    "foo()",
    "$json.__proto__",
    "$json.constructor",
    "$json.prototype",
    "$json[-'constructor']",
    "new Something()",
    "x = 1",
    "$json.bars.push(1)",
    "import('fs')",
    "(() => 1)()",
    "this",
  ])("rejects %s", (source) => {
    expect(() => evaluateExpression(source, context)).toThrow(ExpressionError);
  });

  test("does not expose inherited properties", () => {
    const polluted = Object.create({ leaked: "secret" }) as Record<
      string,
      unknown
    >;
    expect(
      evaluateExpression("$json.leaked", { $json: polluted }),
    ).toBeUndefined();
  });

  test("evaluates the BOS guard and rejects a null prior high", () => {
    const expression =
      "$state.last_high != null && $json.close > $state.last_high";
    expect(evaluateExpression(expression, context)).toBe(true);
    expect(
      evaluateExpression(expression, {
        ...context,
        $state: { last_high: null },
      }),
    ).toBe(false);
  });

  test.each([
    ["Input length limit exceeded", "1".repeat(8193)],
    ["AST depth limit exceeded", `${"(".repeat(33)}1${")".repeat(33)}`],
    [
      "AST node limit exceeded",
      Array.from({ length: 513 }, () => "1").join(" + "),
    ],
    [
      "Member-access depth limit exceeded",
      "$json" + Array.from({ length: 33 }, (_, index) => `.p${index}`).join(""),
    ],
    ["String literal limit exceeded", `'${"a".repeat(1001)}'`],
  ])("enforces %s", (message, expression) => {
    expect(() => evaluateExpression(expression, context)).toThrow(message);
  });
});
