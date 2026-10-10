import { previewSliceRepair } from "../../src/utils/editFieldSliceRepair";
import { compileExpression, ExpressionError, HELPER_LIMITS, TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { applyFieldRows, EditFieldError } from "../src/nodes/logic/editFields";
import { compileNodeParams, compileParamsToSlots } from "../src/utils/templateCompiler";
import type { WorkflowNode } from "../src/nodes/types";
import { snapshotTypedExpressionContext } from "../src/nodes/logic/typedExpressionContext";
import { insertEditFieldReference } from "../../src/utils/editFieldReferenceDrop";
import { remapNodeReferenceMap } from "../../src/utils/remapNodeReferences";

const evaluate = (code: string, input: unknown = {}, context = {}) => evaluateEditTemplate(compileEditTemplate(`{{ ${code} }}`, TYPED_EXPRESSION_FEATURES), { $json: input, ...context });
const row = (value: string) => ({ fieldName: "tail", dataType: "array" as const, valueMode: "expression" as const, value });

describe("typed lastN contract", () => {
  test.each([0, -0, 1, 3, 9])("selects a fresh shallow suffix for %s", count => {
    const source = Object.freeze([{ value: 1 }, { value: 2 }, { value: 3 }]);
    const result = evaluate("lastN(items, count)", { items: source, count }) as unknown[];
    expect(result).toEqual(count === 0 ? [] : source.slice(-Math.min(count, source.length)));
    expect(result).not.toBe(source);
    if (count > 0) expect(result[result.length - 1]).toBe(source[2]);
    expect(source).toHaveLength(3);
  });
  test.each([undefined, null, false, true, "1", -1, 0.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid count %s even with empty input", count => {
    expect(() => evaluate("lastN(items, count)", { items: [], count })).toThrow("count must be");
  });
  test.each([undefined, null, {}, "abc", 1, true])("rejects invalid source %s even with zero count", items => {
    expect(() => evaluate("lastN(items, 0)", { items })).toThrow("source must be an array");
  });
  test("keeps bare lastN, composition, result members and literal -0 slices", () => {
    expect(evaluate("lastN", { lastN: 42 })).toBe(42);
    expect(evaluate("lastN(lastN([1,2,3], 2), 1)[0]")).toBe(3);
    expect(evaluate("lastN([1,2], 1).length")).toBe(1);
    expect(evaluate("[1,2][-0:]")).toEqual([1,2]);
  });
  test.each(["lastN()", "lastN([1])", "lastN([1],1,2)", "foo([1],1)", "$json.lastN([1],1)", "lastN([1],1).slice(1)", "lastN([1],1)[value]", "lastN([1],1)[0:1:1]", "lastN.constructor", "lastN([1],1)()"])("rejects forbidden syntax %s", source => {
    expect(() => evaluate(source)).toThrow(ExpressionError);
  });
  test("does not change base grammar or template cache", () => {
    expect(() => compileExpression("lastN([1],1)")).toThrow("Function calls are not allowed");
    expect(evaluate("lastN([1],1)")).toEqual([1]);
    expect(() => compileEditTemplate("{{ lastN([1],1) }}")).toThrow();
  });
  test("collects both operands and preserves short circuits and undefined compatibility", () => {
    expect(compileEditTemplate(`{{ lastN($("history").json.data.value, $("count").json.data) }}`, TYPED_EXPRESSION_FEATURES).nodeReferences).toEqual(["history", "count"]);
    expect(compileExpression(`lastN(["$('fake').json"],1)`, TYPED_EXPRESSION_FEATURES).nodeReferences).toEqual([]);
    expect(evaluate("false && lastN($('missing').json.data, 1)")).toBe(false);
    expect(evaluate("missing", {})).toBeUndefined();
  });
  test("diagnoses identity, ambiguity and unavailable output without borrowing alias keys", () => {
    const nodes = [{ id: "a", displayName: "History" }, { id: "b", displayName: "History" }];
    expect(() => evaluate("lastN($('gone').json, 1)", {}, { nodes })).toThrow("Missing node identity");
    expect(() => evaluate("lastN($('History').json, 1)", {}, { nodes, $nodes: { a: [1] } })).toThrow("Ambiguous node reference");
    expect(() => evaluate("lastN($('a').json, 1)", {}, { nodes, $nodes: { History: [1] } })).toThrow("Output unavailable");
    expect(evaluate("lastN($('a').json, 1)", {}, { nodes, $nodes: { a: [1] } })).toEqual([1]);
    expect(() => evaluate("lastN($nodes.a.json, 1)", {}, { nodes, $nodes: { a: { json: [1] } }, helperOutputs: {} })).toThrow("Output unavailable");
  });
  test("preserves envelopes and snapshots only current outputs", () => {
    const nodes = [{ id: "history", data: { displayName: "ATR", output: [999] } }, { id: "count" }];
    const outputs = { history: { output: { json: { data: { value: [1,2,3] } } } }, count: { json: { data: 2 } } };
    const snapshot = snapshotTypedExpressionContext(nodes, id => outputs[id as keyof typeof outputs]);
    expect(evaluate("lastN($('ATR').json.data.value, $('count').json.data)", {}, { nodes: snapshot.nodeIdentities, $nodes: snapshot.nodeResults })).toEqual([2,3]);
    expect(snapshotTypedExpressionContext(nodes, () => undefined).nodeResults).toEqual({});
  });
  test("decodes arbitrary JSON key escapes and rejects unknown escapes", () => {
    const key = 'a\b\f\n\r\t"\\\u0000💹';
    expect(evaluate(`lastN($json[${JSON.stringify(key)}],1)`, { [key]: [3] })).toEqual([3]);
    expect(() => evaluate(String.raw`lastN($json["\q"],1)`)).toThrow("Unsupported string escape");
  });
  test("returns native arrays, enforces destination type and gives argument positions", () => {
    expect(applyFieldRows([row("{{ lastN(items,1) }}")], { input: { items: [1,2] }, legacyResultSeed: {} }).tail).toEqual([2]);
    expect(() => applyFieldRows([row("prefix {{ lastN(items,1) }}")], { input: { items: [1] }, legacyResultSeed: {} })).toThrow("expected Array");
    try { applyFieldRows([row("{{ lastN([], -1) }}")], { nodeId: "edit", input: {}, legacyResultSeed: {} }); throw Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(EditFieldError); expect((error as EditFieldError).details).toMatchObject({ nodeId: "edit", rowIndex: 0, fieldName: "tail", phase: "argument", argument: 2, position: 13 }); }
  });
});

describe("helper budgets and strict boundary", () => {
  test("preserves ordinary JSON data named toJSON", () => {
    expect(evaluate("lastN(items,1)", {items:[{toJSON:"ordinary data"}]})).toEqual([{toJSON:"ordinary data"}]);
  });
  test.each([undefined, () => 1, Symbol("x"), BigInt(1), Infinity, NaN, new Date(), new Map()])("rejects selected non-JSON value %s", item => {
    expect(() => evaluate("lastN(items,1)", { items: [item] })).toThrow();
  });
  test("rejects sparse slots, undefined, cycles and accessors without invoking them", () => {
    expect(() => evaluate("lastN(items,1)", { items: new Array(1) })).toThrow("Sparse");
    expect(() => evaluate("lastN(items,1)", { items: [{ missing: undefined }] })).toThrow("undefined");
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => evaluate("lastN(items,1)", { items: [cycle] })).toThrow("Cyclic");
    const getter = jest.fn(() => [1]);
    expect(() => evaluate("lastN(items,1)", Object.defineProperty({}, "items", { get: getter }))).toThrow("Accessor");
    expect(getter).not.toHaveBeenCalled();
    const selectedGetter = jest.fn(() => 1);
    expect(() => evaluate("lastN(items,1)[0].value", { items: [Object.defineProperty({}, "value", { enumerable: true, get: selectedGetter })] })).toThrow("Accessor");
    expect(selectedGetter).not.toHaveBeenCalled();
    expect(() => evaluate("lastN(items,1)", { items: [{ toJSON: () => null }] })).toThrow("serializers");
  });
  test("visits only the selected suffix, preserving null and legacy undefined", () => {
    const items = new Array(10_000_000); items[items.length - 1] = null;
    Object.defineProperty(items, 0, { get: () => { throw new Error("unselected getter"); } });
    expect(evaluate("lastN(items,1)", { items })).toEqual([null]);
    expect(evaluate("lastN(items,0)", { items })).toEqual([]);
    expect(evaluate("items", { items: [undefined] })).toEqual([undefined]);
  });
  test("meters allocations across nested calls, slices and segments", () => {
    const items = Array.from({ length: 60_000 }, () => 1);
    expect(() => evaluate("lastN(lastN(items,60000),60000)", { items })).toThrow("allocation limit");
    const compiled = compileEditTemplate("{{ lastN(items,60000).length }} {{ lastN(items,60000).length }}", TYPED_EXPRESSION_FEATURES);
    expect(() => evaluateEditTemplate(compiled, { $json: { items } })).toThrow("allocation limit");
    expect(() => evaluate("lastN(items[:],1)", { items: new Array(HELPER_LIMITS.copiedElements + 1) })).toThrow("allocation limit");
    expect(evaluate("lastN(items,1)", { items })).toEqual([1]);
    expect(evaluate("lastN(items,1)", { items })).toEqual([1]);
  });
  test("counts escaping and multibyte UTF-8 bytes at exact limits", () => {
    expect(evaluate("lastN(items,1)[0]", { items: ["a".repeat(HELPER_LIMITS.outputBytes - 4)] })).toHaveLength(HELPER_LIMITS.outputBytes - 4);
    expect(() => evaluate("lastN(items,1)[0]", { items: ["a".repeat(HELPER_LIMITS.outputBytes - 3)] })).toThrow("UTF-8");
    expect(() => evaluate("lastN(items,1)", { items: ["💹".repeat(70_000)] })).toThrow("UTF-8");
    expect(() => evaluate("lastN(items,1)", { items: ["\u0000".repeat(50_000)] })).toThrow("UTF-8");
  });
});

describe("dependencies, insertion and persistence", () => {
  test("retains raw typed rows and both dependencies in static metadata and slots", () => {
    const source = `{{ lastN($("history").json.data.value, $("count").json.data) }}`;
    const node = { id: "edit", name: "Edit Fields", node_type: "main", category: "Logic", values: { fields: [row(source), { ...row(`{{ $('fake').json }}`), valueMode: "fixed" }] } } as WorkflowNode;
    const compiled = compileNodeParams(node, [node, { id: "history" }, { id: "count" }] as WorkflowNode[]);
    expect(compiled.templateDeps).toEqual(["history", "count"]);
    expect(compiled.resolve!({}, {}).fields[0].value).toBe(source);
    expect(compileParamsToSlots(compiled, new Map([["history", 0], ["count", 1]]), compiled.templateDeps)!([1,2]).fields[0].value).toBe(source);
  });
  test("remaps both operands simultaneously while preserving fixed and quoted values", () => {
    const value = [row(`{{ lastN($("A").json.items, $("B").json.count) }}`), { ...row(`{{ $("A").json }}`), valueMode: "fixed" }, row(`{{ "$('A').json" }}`)];
    const remapped = remapNodeReferenceMap(value, { A: "B", B: "C" });
    expect(remapped[0].value).toBe(`{{ lastN($("B").json.items, $("C").json.count) }}`);
    expect(remapped[1]).toEqual(value[1]); expect(remapped[2]).toEqual(value[2]);
  });
  test("places raw selectors in unfinished code and rejects unsafe boundaries", () => {
    const ref = '{{ $("history").json.items }}';
    expect(insertEditFieldReference("{{ lastN(, 1) }}", ref, 9, 9)?.value).toBe('{{ lastN($("history").json.items, 1) }}');
    expect(insertEditFieldReference("{{ value >", ref, 3, 8)?.value).toBe('{{ $("history").json.items >');
    expect(insertEditFieldReference('{{ "value" }}', ref, 5, 5)).toBeNull();
    expect(insertEditFieldReference('{{ "value" }}', ref, 4, 11)).toBeNull();
    expect(insertEditFieldReference("{{ value }}", ref, 1, 1)).toBeNull();
    expect(insertEditFieldReference("{ value", ref, 0, 0)).toBeNull();
    expect(insertEditFieldReference("{{ value }}", ref, 0, 11)?.value).toBe(ref);
    expect(insertEditFieldReference("{{ value }}", ref, 3, 8, false)).toBeNull();
    expect(insertEditFieldReference("value", ref, 99, 100)).toBeNull();
  });
});


test("repairs only the recognized nested-reference suffix form, with a preview", () => {
  expect(previewSliceRepair('{{ $("history").json.items[-{{ $("count").json.data }}:] }}')).toBe('{{ lastN($("history").json.items, $("count").json.data) }}');
  expect(previewSliceRepair('{{ "literal {{ quoted }}" }}')).toBeNull();
  expect(previewSliceRepair('{{ items[-{{ arbitrary }}:] }}')).toBeNull();
});

test("offers the screenshot suffix repair without expanding the parser grammar", () => {
  const source = '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}';
  expect(() => compileEditTemplate(source, TYPED_EXPRESSION_FEATURES)).toThrow("Bracket access requires");
  expect(previewSliceRepair(source)).toBe('{{ lastN($("get_atr_history").json.data.value, $("short_len").json.data) }}');
  for (const value of ['{{ items[-5:] }}', '{{ items[-0:] }}', '{{ items[count:] }}', '{{ items[-$("count").json.data:2] }}', '{{ "items[-$(count).json.data:]" }}', 'prefix {{ items[-$("count").json.data:] }}']) {
    expect(previewSliceRepair(value)).toBeNull();
  }
});

test("remaps mixed selector syntax in one pass when replacement lengths change", () => {
  const source = row('{{ lastN($("A").json.items, $node["B"].json.count) }}');
  expect(remapNodeReferenceMap(source, { A: "long-canonical-id", B: "next" }).value).toBe('{{ lastN($("long-canonical-id").json.items, $node["next"].json.count) }}');
});

test("rejects helper output traversal past the depth limit and cancelled actions", () => {
  let item: unknown = 1;
  for (let i = 0; i < 35; i++) item = { item };
  expect(() => evaluate("lastN(items,1)", { items: [item] })).toThrow("depth limit");
  const controller = new AbortController(); controller.abort();
  expect(() => applyFieldRows([row("{{ lastN([],0) }}")], { input: {}, legacyResultSeed: {}, abortSignal: controller.signal })).toThrow("cancelled");
});
