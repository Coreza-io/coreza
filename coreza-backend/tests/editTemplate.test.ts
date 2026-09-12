import {
  compileEditTemplate,
  evaluateEditTemplate,
} from "../src/nodes/logic/editTemplate";

describe("Edit Fields templates", () => {
  const context = {
    $json: { a: 105, b: 100, bars: [{ Close: 1 }, { Close: 2 }] },
  };

  test("preserves native single-block values and renders mixed templates", () => {
    expect(
      evaluateEditTemplate(compileEditTemplate("{{ a > b }}"), context),
    ).toBe(true);
    expect(
      evaluateEditTemplate(compileEditTemplate("{{ a }} > {{ b }}"), context),
    ).toBe("105 > 100");
    expect(evaluateEditTemplate(compileEditTemplate("a > b"), context)).toBe(
      "a > b",
    );
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ null }}x{{ undefined }}"),
        context,
      ),
    ).toBe("x");
  });

  test("supports negative indexes, slices, projection, and quoted delimiters", () => {
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ bars[-1].Close }}"),
        context,
      ),
    ).toBe(2);
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ bars[-2:].Close }}"),
        context,
      ),
    ).toEqual([1, 2]);
    expect(
      evaluateEditTemplate(
        compileEditTemplate("before {{ 'a }} b' }} after"),
        context,
      ),
    ).toBe("before a }} b after");
  });

  test("distinguishes array properties and indexes from explicit slice projection", () => {
    const context = {
      $json: {
        bars: [
          { Close: 10, quote: { currency: "USD" } },
          { Close: 20, quote: { currency: "EUR" } },
        ],
      },
    };
    expect(
      evaluateEditTemplate(compileEditTemplate("{{ bars.length }}"), context),
    ).toBe(2);
    expect(
      evaluateEditTemplate(
        compileEditTemplate('{{ bars["0"].Close }}'),
        context,
      ),
    ).toBe(10);
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ bars[-1].Close }}"),
        context,
      ),
    ).toBe(20);
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ bars[-2:].Close }}"),
        context,
      ),
    ).toEqual([10, 20]);
    expect(
      evaluateEditTemplate(
        compileEditTemplate("{{ bars[-2:].quote.currency }}"),
        context,
      ),
    ).toEqual(["USD", "EUR"]);
  });

  test("reports expression positions in template-source coordinates", () => {
    expect(() =>
      evaluateEditTemplate(compileEditTemplate("prefix {{   1 + }}"), context),
    ).toThrow("position 15");
  });

  test("does not cache results between evaluations", () => {
    const compiled = compileEditTemplate("{{ current_bar.Close > last_high }}");
    expect(
      evaluateEditTemplate(compiled, {
        $json: { current_bar: { Close: 101 }, last_high: 100 },
      }),
    ).toBe(true);
    expect(
      evaluateEditTemplate(compiled, {
        $json: { current_bar: { Close: 99 }, last_high: 100 },
      }),
    ).toBe(false);
  });

  test("compiles only real named-node dependencies", () => {
    expect(
      compileEditTemplate(
        "text $('Ignored').json.value {{ $('Used').json.value }} {{ '$node[\\\"Also ignored\\\"]' }}",
      ).nodeReferences,
    ).toEqual(["Used"]);
  });

  test.each([
    "{{ $json['__proto__'] }}",
    "{{ $json['prototype'] }}",
    "{{ $json['constructor'] }}",
  ])("blocks %s", (source) => {
    expect(
      () =>
        compileEditTemplate(source) &&
        evaluateEditTemplate(compileEditTemplate(source), context),
    ).toThrow("not allowed");
  });
});
