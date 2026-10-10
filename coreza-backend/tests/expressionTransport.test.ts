import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";
import { prepareExpressionTransport, restoreExpressionTransport } from "../src/nodes/logic/expressionTransport";
import { applyFieldRows } from "../src/nodes/logic/editFields";

const compile = (code: string) => compileEditTemplate(`{{ ${code} }}`, TYPED_EXPRESSION_FEATURES);
const wire = (packet: unknown) => JSON.parse(JSON.stringify(packet));
test.each(["4294967295", "4294967296", "999999999999999999999999999999"])("rejects non-index numeric array property %s before direct or manual serialization", key => {
  for (const value of [undefined, () => 1, 7]) {
    const selected = [1];
    Object.defineProperty(selected, key, { value, enumerable: true });
    const compiled = compile("(items)[-(1 + 0):]");
    const context = { $json: { items: [selected] } };
    expect(() => evaluateEditTemplate(compiled, context)).toThrow("Custom array output properties");
    expect(() => prepareExpressionTransport(compiled, context)).toThrow("Custom array output properties");
  }
});
test("preserves dense arrays and numeric plain-object keys in direct and manual output", () => {
  const compiled = compile("(items)[-(1 + 0):]");
  const context = { $json: { items: [[{ "4294967295": "data" }, 2]] } };
  expect(evaluateEditTemplate(compiled, context)).toEqual(context.$json.items);
  expect(evaluateEditTemplate(compiled, restoreExpressionTransport(wire(prepareExpressionTransport(compiled, context))))).toEqual(context.$json.items);
});
test("manual transport preserves suffixes without reading unselected serializers or BigInt", () => {
  let calls = 0;
  const items = [1n, { toJSON: () => { calls++; return null; } }, { value: 3 }];
  Object.defineProperty(items, "toJSON", { value: () => { calls++; return []; } });
  const compiled = compile('($("history").json.items)[-(1 + 0):]');
  const nodes = [{ id: "history" }];
  const packet = prepareExpressionTransport(compiled, { $json: {}, expressionOutputs: { history: { output: { json: { items } } } }, nodes });
  const restored = restoreExpressionTransport(wire(packet));
  expect(evaluateEditTemplate(compiled, { ...restored, nodes })).toEqual([{ value: 3 }]);
  expect(calls).toBe(0);
  expect(applyFieldRows([{ fieldName:"tail",dataType:"array",valueMode:"expression",value:'{{ ($("history").json.items)[-(1 + 0):] }}' }], {input:{},legacyResultSeed:{},context:{nodes,expressionContexts:{0:wire(packet)}}}).tail).toEqual([{ value: 3 }]);
});
test("a tiny suffix transports a large history without scanning its prefix", () => {
  const items: unknown[] = [];
  items[0xfffffffe] = 7;
  Object.defineProperty(items, "0", { get: () => { throw Error("unselected getter"); } });
  const compiled = compile("(items)[-(1 + 0):]");
  const packet = prepareExpressionTransport(compiled, { $json: { items } });
  expect(JSON.stringify(packet).length).toBeLessThan(1000);
  expect(evaluateEditTemplate(compiled, restoreExpressionTransport(wire(packet)))).toEqual([7]);
  const zero = compile("items[:zero]");
  expect(evaluateEditTemplate(zero, restoreExpressionTransport(wire(prepareExpressionTransport(zero, { $json: { items, zero: 0 } }))))).toEqual([]);
});
test("skipped ambiguous references remain skipped after manual transport", () => {
  const compiled = compile('false && ($("same").json.items)[-(1 + 0):]');
  const nodes = [{ id:"a",displayName:"same" },{ id:"b",displayName:"same" }];
  const restored = restoreExpressionTransport(wire(prepareExpressionTransport(compiled, { $json:{}, nodes })));
  expect(evaluateEditTemplate(compiled, { ...restored, nodes })).toBe(false);
});
test("captures slices, projections, nested slices, mixed segments and shared identity", () => {
  const shared = Object.freeze({ value:4 });
  const context = { $json: Object.freeze({ items:Object.freeze([shared,shared]) }) };
  for (const code of ["((items)[-(2 + 0):])[-(1 + 0):]", "(items[:].value)[-(1 + 0):]", "items[0] === items[1] && (items)[-(1 + 0):]"]) {
    const compiled = compile(code);
    expect(evaluateEditTemplate(compiled, restoreExpressionTransport(wire(prepareExpressionTransport(compiled, context))))).toEqual(evaluateEditTemplate(compiled, context));
  }
  const mixed = compileEditTemplate("tail={{ (items)[-(1 + 0):] }}", TYPED_EXPRESSION_FEATURES);
  expect(evaluateEditTemplate(mixed, restoreExpressionTransport(wire(prepareExpressionTransport(mixed, context))))).toBe('tail=[{"value":4}]');
});
test("server rechecks argument and selected-output contracts", () => {
  const compiled = compile("(items)[-(1 + 0):]");
  const restored = restoreExpressionTransport(wire(prepareExpressionTransport(compiled, { $json:{items:[1]} })));
  expect(() => evaluateEditTemplate(compile("items[:1.5 + 0]"), restored)).toThrow("Slice bound must be");
  expect(() => prepareExpressionTransport(compiled, {$json:{items:[undefined]}})).toThrow("Unsupported output undefined");
  expect(() => restoreExpressionTransport({ roots:{}, objects:[{array:true,length:0x100000000,entries:[]}] })).toThrow("Invalid expression transport context");
  expect(() => restoreExpressionTransport({ roots:{json:{ref:9},nodes:{undefined:true},outputs:{undefined:true}},objects:[] })).toThrow("Invalid expression transport context");
});
