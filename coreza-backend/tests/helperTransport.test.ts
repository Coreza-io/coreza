import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";
import { prepareHelperTransport, restoreHelperTransport } from "../src/nodes/logic/helperTransport";
import { applyFieldRows } from "../src/nodes/logic/editFields";

const compile = (code: string) => compileEditTemplate(`{{ ${code} }}`, TYPED_EXPRESSION_FEATURES);
const wire = (packet: unknown) => JSON.parse(JSON.stringify(packet));
test("manual transport preserves suffixes without reading unselected serializers or BigInt", () => {
  let calls = 0;
  const items = [1n, { toJSON: () => { calls++; return null; } }, { value: 3 }];
  Object.defineProperty(items, "toJSON", { value: () => { calls++; return []; } });
  const compiled = compile('lastN($("history").json.items, 1)');
  const nodes = [{ id: "history" }];
  const packet = prepareHelperTransport(compiled, { $json: {}, helperOutputs: { history: { output: { json: { items } } } }, nodes });
  const restored = restoreHelperTransport(wire(packet));
  expect(evaluateEditTemplate(compiled, { ...restored, nodes })).toEqual([{ value: 3 }]);
  expect(calls).toBe(0);
  expect(applyFieldRows([{ fieldName:"tail",dataType:"array",valueMode:"expression",value:'{{ lastN($("history").json.items, 1) }}' }], {input:{},legacyResultSeed:{},context:{nodes,helperContexts:{0:wire(packet)}}}).tail).toEqual([{ value: 3 }]);
});
test("a tiny suffix transports a large history without scanning its prefix", () => {
  const items: unknown[] = [];
  items[0xfffffffe] = 7;
  Object.defineProperty(items, "0", { get: () => { throw Error("unselected getter"); } });
  const compiled = compile("lastN(items, 1)");
  const packet = prepareHelperTransport(compiled, { $json: { items } });
  expect(JSON.stringify(packet).length).toBeLessThan(1000);
  expect(evaluateEditTemplate(compiled, restoreHelperTransport(wire(packet)))).toEqual([7]);
  const zero = compile("lastN(items, 0)");
  expect(evaluateEditTemplate(zero, restoreHelperTransport(wire(prepareHelperTransport(zero, { $json: { items } }))))).toEqual([]);
});
test("skipped ambiguous references remain skipped after manual transport", () => {
  const compiled = compile('false && lastN($("same").json.items, 1)');
  const nodes = [{ id:"a",displayName:"same" },{ id:"b",displayName:"same" }];
  const restored = restoreHelperTransport(wire(prepareHelperTransport(compiled, { $json:{}, nodes })));
  expect(evaluateEditTemplate(compiled, { ...restored, nodes })).toBe(false);
});
test("captures slices, projections, nested calls, mixed segments and shared identity", () => {
  const shared = Object.freeze({ value:4 });
  const context = { $json: Object.freeze({ items:Object.freeze([shared,shared]) }) };
  for (const code of ["lastN(lastN(items, 2), 1)", "lastN(items[:].value, 1)", "items[0] === items[1] && lastN(items, 1)"]) {
    const compiled = compile(code);
    expect(evaluateEditTemplate(compiled, restoreHelperTransport(wire(prepareHelperTransport(compiled, context))))).toEqual(evaluateEditTemplate(compiled, context));
  }
  const mixed = compileEditTemplate("tail={{ lastN(items, 1) }}", TYPED_EXPRESSION_FEATURES);
  expect(evaluateEditTemplate(mixed, restoreHelperTransport(wire(prepareHelperTransport(mixed, context))))).toBe('tail=[{"value":4}]');
});
test("server rechecks argument and selected-output contracts", () => {
  const compiled = compile("lastN(items, 1)");
  const restored = restoreHelperTransport(wire(prepareHelperTransport(compiled, { $json:{items:[1]} })));
  expect(() => evaluateEditTemplate(compile("lastN(items, -1)"), restored)).toThrow("count must be");
  expect(() => prepareHelperTransport(compiled, {$json:{items:[undefined]}})).toThrow("Unsupported output undefined");
  expect(() => restoreHelperTransport({ roots:{}, objects:[{array:true,length:0x100000000,entries:[]}] })).toThrow("Invalid helper transport context");
  expect(() => restoreHelperTransport({ roots:{json:{ref:9},nodes:{undefined:true},outputs:{undefined:true}},objects:[] })).toThrow("Invalid helper transport context");
});
