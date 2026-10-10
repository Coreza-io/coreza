import { compileExpression, ExpressionError, EXPRESSION_LIMITS, TYPED_EXPRESSION_FEATURES } from "../src/nodes/logic/safeExpression";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { applyFieldRows, EditFieldError } from "../src/nodes/logic/editFields";
import { compileNodeParams, compileParamsToSlots } from "../src/utils/templateCompiler";
import type { WorkflowNode } from "../src/nodes/types";
import { snapshotTypedExpressionContext } from "../src/nodes/logic/typedExpressionContext";
import { insertEditFieldReference } from "../../src/utils/editFieldReferenceDrop";
import { remapNodeReferenceMap } from "../../src/utils/remapNodeReferences";

const evaluate = (code: string, input: unknown = {}, context = {}) => evaluateEditTemplate(compileEditTemplate(`{{ ${code} }}`, TYPED_EXPRESSION_FEATURES), { $json: input, ...context });
const row = (value: string) => ({ fieldName: "tail", dataType: "array" as const, valueMode: "expression" as const, value });

describe("computed slice bounds", () => {
  test.each([0, -0, 1, 3, 9, -1])("resolves a count of %s without mutating the source", count => {
    const items = Object.freeze([1,2,3]);
    const result = evaluate("items[-count:]", { items, count });
    expect(result).toEqual(items.slice(-count));
    expect(result).not.toBe(items);
    expect(items).toEqual([1,2,3]);
  });
  test("resolves both bounds, arithmetic, omitted bounds and nested expressions", () => {
    const input = { items: [1,2,3,4,5], start: 1, end: -1, count: 2 };
    expect(evaluate("items[start:end]", input)).toEqual([2,3,4]);
    expect(evaluate("items[:end]", input)).toEqual([1,2,3,4]);
    expect(evaluate("items[-(count + 1):]", input)).toEqual([3,4,5]);
    expect(evaluate("items[-{{ count }}:]", input)).toEqual([4,5]);
    expect(evaluate("items[{{ {{ start }} }}:{{ end }}]", input)).toEqual([2,3,4]);
    expect(evaluate("items[end:start]", input)).toEqual([]);
    expect(evaluate("items[start:end][-count:]", input)).toEqual([3,4]);
    expect(evaluate("items[-0:]", input)).toEqual(input.items);
    expect(evaluate('"literal {{ count }}"', input)).toBe("literal {{ count }}");
  });
  test.each(["5", null, undefined, true, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numeric bound %s", bound => {
    for (const source of ["items[bound:]", "items[:bound]"])
      expect(() => evaluate(source, { items: [], bound })).toThrow("Slice bound must be");
  });
  test.each([undefined, null, {}, "abc", 1, true])("rejects non-array source %s", items => {
    expect(() => evaluate("items[count:]", { items, count: 0 })).toThrow("Slice source must be an array");
  });
  test.each(["items[count]", "items[start:end:step]", "items.slice(1)", "items[{{ count }}]", "items[{{ 1 }}]", "{{ count }}", "items[-{{ count }:]", "items[-{{ count }}}:]"])("keeps unsupported or malformed syntax rejected: %s", source => {
    expect(() => evaluate(source, { items: [1], count: 1, start: 0, end: 1, step: 1 })).toThrow(ExpressionError);
  });
  test("preserves legacy grammar, diagnostics and cache separation", () => {
    expect(() => compileExpression("items[-count:]")).toThrow("Computed slice bounds require");
    expect(() => compileEditTemplate("{{ items[-{{ count }}:] }}")).toThrow("Nested template delimiter");
    expect(compileEditTemplate("{{ items[-count:] }}", TYPED_EXPRESSION_FEATURES).hasComputedSlices).toBe(true);
    expect(() => compileEditTemplate("{{ items[-count:] }}")).toThrow();
    expect(() => evaluate("lastN(items, count)", { items: [1], count: 1 })).toThrow("lastN has been removed");
    expect(evaluate("lastN", { lastN: "ordinary field" })).toBe("ordinary field");
    expect(compileExpression("items[9007199254740992:]").evaluate({ $json: { items: [1] } })).toEqual([]);
    try { applyFieldRows([row("{{ items[:bound] }}")], { nodeId: "edit", input: { items: [], bound: 1.5 }, legacyResultSeed: {} }); throw Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(EditFieldError); expect((error as EditFieldError).details).toMatchObject({ nodeId: "edit", rowIndex: 0, fieldName: "tail", phase: "argument", argument: 3 }); }
  });
  test("collects bound references, preserves envelopes and uses current canonical outputs", () => {
    const source = '$("get_atr_history").json.data.value[-$("short_len").json.data:]';
    const nodes = [{ id: "history", displayName: "get_atr_history" }, { id: "count", displayName: "short_len" }];
    const outputs = { history: { success: true, data: { value: [1,2,3,4,5] } }, count: { success: true, data: 5 } };
    const snapshot = snapshotTypedExpressionContext(nodes, id => outputs[id as keyof typeof outputs]);
    expect(compileExpression(source, TYPED_EXPRESSION_FEATURES).nodeReferences).toEqual(["get_atr_history", "short_len"]);
    expect(evaluate(source, {}, { nodes: snapshot.nodeIdentities, expressionOutputs: snapshot.nodeResults })).toEqual([1,2,3,4,5]);
    expect(() => evaluate(source, {}, { nodes, expressionOutputs: {} })).toThrow("Output unavailable");
    expect(() => evaluate('$("gone").json[-count:]', { count: 1 }, { nodes })).toThrow("Missing node identity");
    expect(() => evaluate('$("same").json[-count:]', { count: 1 }, { nodes: [{ id: "a", displayName: "same" }, { id: "b", displayName: "same" }] })).toThrow("Ambiguous node reference");
    expect(evaluate('false && $("gone").json[-count:]', { count: 1 })).toBe(false);
  });
  test("returns native arrays and preserves destination type checking", () => {
    expect(applyFieldRows([row("{{ items[-count:] }}")], { input: { items: [1,2], count: 1 }, legacyResultSeed: {} }).tail).toEqual([2]);
    expect(() => applyFieldRows([row("prefix {{ items[-count:] }}")], { input: { items: [1], count: 1 }, legacyResultSeed: {} })).toThrow("expected Array");
  });
});

describe("expression budgets and strict boundary", () => {
  test("preserves ordinary JSON data named toJSON", () => {
    expect(evaluate("(items)[-(1 + 0):]", {items:[{toJSON:"ordinary data"}]})).toEqual([{toJSON:"ordinary data"}]);
  });
  test.each([undefined, () => 1, Symbol("x"), BigInt(1), Infinity, NaN, new Date(), new Map()])("rejects selected non-JSON value %s", item => {
    expect(() => evaluate("(items)[-(1 + 0):]", { items: [item] })).toThrow();
  });
  test("rejects sparse slots, undefined, cycles and accessors without invoking them", () => {
    expect(() => evaluate("(items)[-(1 + 0):]", { items: new Array(1) })).toThrow("Sparse");
    expect(() => evaluate("(items)[-(1 + 0):]", { items: [{ missing: undefined }] })).toThrow("undefined");
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => evaluate("(items)[-(1 + 0):]", { items: [cycle] })).toThrow("Cyclic");
    const getter = jest.fn(() => [1]);
    expect(() => evaluate("(items)[-(1 + 0):]", Object.defineProperty({}, "items", { get: getter }))).toThrow("Accessor");
    expect(getter).not.toHaveBeenCalled();
    const selectedGetter = jest.fn(() => 1);
    expect(() => evaluate("(items)[-(1 + 0):][0].value", { items: [Object.defineProperty({}, "value", { enumerable: true, get: selectedGetter })] })).toThrow("Accessor");
    expect(selectedGetter).not.toHaveBeenCalled();
    expect(() => evaluate("(items)[-(1 + 0):]", { items: [{ toJSON: () => null }] })).toThrow("serializers");
  });
  test("visits only the selected suffix, preserving null and legacy undefined", () => {
    const items = new Array(10_000_000); items[items.length - 1] = null;
    Object.defineProperty(items, 0, { get: () => { throw new Error("unselected getter"); } });
    expect(evaluate("(items)[-(1 + 0):]", { items })).toEqual([null]);
    expect(evaluate("items[:zero]", { items, zero: 0 })).toEqual([]);
    expect(evaluate("items", { items: [undefined] })).toEqual([undefined]);
  });
  test("meters allocations across nested calls, slices and segments", () => {
    const items = Array.from({ length: 60_000 }, () => 1);
    expect(() => evaluate("((items)[-(60000 + 0):])[-(60000 + 0):]", { items })).toThrow("allocation limit");
    const compiled = compileEditTemplate("{{ (items)[-(60000 + 0):].length }} {{ (items)[-(60000 + 0):].length }}", TYPED_EXPRESSION_FEATURES);
    expect(() => evaluateEditTemplate(compiled, { $json: { items } })).toThrow("allocation limit");
    expect(() => evaluate("(items[:])[-(1 + 0):]", { items: new Array(EXPRESSION_LIMITS.copiedElements + 1) })).toThrow("allocation limit");
    expect(evaluate("(items)[-(1 + 0):]", { items })).toEqual([1]);
    expect(evaluate("(items)[-(1 + 0):]", { items })).toEqual([1]);
  });
  test("counts escaping and multibyte UTF-8 bytes at exact limits", () => {
    expect(evaluate("(items)[-(1 + 0):][0]", { items: ["a".repeat(EXPRESSION_LIMITS.outputBytes - 4)] })).toHaveLength(EXPRESSION_LIMITS.outputBytes - 4);
    expect(() => evaluate("(items)[-(1 + 0):][0]", { items: ["a".repeat(EXPRESSION_LIMITS.outputBytes - 3)] })).toThrow("UTF-8");
    expect(() => evaluate("(items)[-(1 + 0):]", { items: ["💹".repeat(70_000)] })).toThrow("UTF-8");
    expect(() => evaluate("(items)[-(1 + 0):]", { items: ["\u0000".repeat(50_000)] })).toThrow("UTF-8");
  });
});

describe("dependencies, insertion and persistence", () => {
  test("retains raw typed rows and both dependencies in static metadata and slots", () => {
    const source = `{{ ($("history").json.data.value)[-($("count").json.data + 0):] }}`;
    const node = { id: "edit", name: "Edit Fields", node_type: "main", category: "Logic", values: { fields: [row(source), { ...row(`{{ $('fake').json }}`), valueMode: "fixed" }] } } as WorkflowNode;
    const compiled = compileNodeParams(node, [node, { id: "history" }, { id: "count" }] as WorkflowNode[]);
    expect(compiled.templateDeps).toEqual(["history", "count"]);
    expect(compiled.resolve!({}, {}).fields[0].value).toBe(source);
    expect(compileParamsToSlots(compiled, new Map([["history", 0], ["count", 1]]), compiled.templateDeps)!([1,2]).fields[0].value).toBe(source);
  });
  test("remaps both operands simultaneously while preserving fixed and quoted values", () => {
    const value = [row(`{{ ($("A").json.items)[-($("B").json.count + 0):] }}`), { ...row(`{{ $("A").json }}`), valueMode: "fixed" }, row(`{{ "$('A').json" }}`)];
    const remapped = remapNodeReferenceMap(value, { A: "B", B: "C" });
    expect(remapped[0].value).toBe(`{{ ($("B").json.items)[-($("C").json.count + 0):] }}`);
    expect(remapped[1]).toEqual(value[1]); expect(remapped[2]).toEqual(value[2]);
  });
  test("places raw selectors in unfinished code and rejects unsafe boundaries", () => {
    const ref = '{{ $("history").json.items }}';
    expect(insertEditFieldReference("{{ items[-:] }}", ref, 10, 10)?.value).toBe('{{ items[-$("history").json.items:] }}');
    expect(insertEditFieldReference("{{ value >", ref, 3, 8)?.value).toBe('{{ $("history").json.items >');
    expect(insertEditFieldReference('{{ "value" }}', ref, 5, 5)).toBeNull();
    expect(insertEditFieldReference('{{ "value" }}', ref, 4, 11)).toBeNull();
    expect(insertEditFieldReference("{{ value }}", ref, 1, 1)).toBeNull();
    expect(insertEditFieldReference("{ value", ref, 0, 0)).toBeNull();
    expect(insertEditFieldReference("{{ value }}", ref, 0, 11)?.value).toBe(ref);
    expect(insertEditFieldReference("{{ value }}", ref, 3, 8, false)).toBeNull();
    expect(insertEditFieldReference("value", ref, 99, 100)).toBeNull();
    const nested = "{{ items[-{{  }}:] }}";
    const offset = nested.indexOf("  }}") + 1;
    const insertion = insertEditFieldReference(nested, ref, offset, offset)!;
    expect(insertion.value).toBe('{{ items[-{{ $("history").json.items }}:] }}');
    expect(compileEditTemplate(insertion.value, TYPED_EXPRESSION_FEATURES).nodeReferences).toEqual(["history"]);
  });
});
