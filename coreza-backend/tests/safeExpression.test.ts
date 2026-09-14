import {
  compileExpression,
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

  test("evaluates array literals, nested arrays, and member access", () => {
    expect(evaluateExpression("[]", context)).toEqual([]);
    expect(evaluateExpression("[1]", context)).toEqual([1]);
    expect(evaluateExpression("[1, 2, 3]", context)).toEqual([1, 2, 3]);
    expect(evaluateExpression("[1 + 2, 3 * 4]", context)).toEqual([3, 12]);
    expect(evaluateExpression("[true, false, null]", context)).toEqual([
      true,
      false,
      null,
    ]);
    expect(evaluateExpression(`["a", 'b']`, context)).toEqual(["a", "b"]);
    expect(evaluateExpression("[3, 1, 2][0]", context)).toBe(3);
    expect(evaluateExpression("[[1, 2], [3, 4]][1][0]", context)).toBe(3);
  });

  test("collects node references from array literal elements", () => {
    const compiled = compileExpression(
      `[$("A").json.value, $("B").json.value]`,
    );

    expect(compiled.nodeReferences).toEqual(["A", "B"]);
    expect(
      compiled.evaluate({
        $json: {},
        $nodes: {
          A: { json: { value: 1 } },
          B: { json: { value: 2 } },
        },
      }),
    ).toEqual([1, 2]);
  });

  test("preserves existing operators, references, indexes, and slices", () => {
    const regressionContext = {
      $json: {
        value: 2,
        items: [{ close: 10 }, { close: 20 }, { close: 30 }],
      },
      $nodes: { Node: { json: { data: { value: 4 } } } },
    };

    expect(evaluateExpression("1 + 2", regressionContext)).toBe(3);
    expect(evaluateExpression("value > 1", regressionContext)).toBe(true);
    expect(evaluateExpression("true && value === 2", regressionContext)).toBe(
      true,
    );
    expect(evaluateExpression("$json.value", regressionContext)).toBe(2);
    expect(
      evaluateExpression(`$("Node").json.data.value`, regressionContext),
    ).toBe(4);
    expect(evaluateExpression("$json.items[0].close", regressionContext)).toBe(
      10,
    );
    expect(evaluateExpression("$json.items[-1].close", regressionContext)).toBe(
      30,
    );
    expect(evaluateExpression("$json.items[1:3]", regressionContext)).toEqual([
      { close: 20 },
      { close: 30 },
    ]);
    expect(
      evaluateExpression("$json.items[-2:].close", regressionContext),
    ).toEqual([20, 30]);
  });

  test.each([
    ["[1,]", 'Unexpected token "," at position 2'],
    ["[,1]", 'Unexpected token "," at position 1'],
    ["[1,,2]", 'Unexpected token "," at position 3'],
    ["[1", 'Expected "," or "]" at position 2'],
    [
      "[1:3]",
      "Array slices are only valid on an existing array value at position 2",
    ],
  ])("rejects malformed array literal %s", (source, message) => {
    expect(() => evaluateExpression(source, context)).toThrow(message);
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
    [
      "Array literal element limit exceeded",
      `[${Array.from({ length: 257 }, () => "1").join(",")}]`,
    ],
    ["AST depth limit exceeded", `${"[".repeat(33)}1${"]".repeat(33)}`],
  ])("enforces %s", (message, expression) => {
    expect(() => evaluateExpression(expression, context)).toThrow(message);
  });
});
