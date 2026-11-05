import { freezeVariableSnapshot, validateVariable, referencesVariables } from "../src/variables/contract";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES, evaluateExpression } from "../src/nodes/logic/safeExpression";
import { resolveReferences } from "../src/utils/resolveReferences";
import { ParameterResolver } from "../src/engine/parameterResolver";
import { compileNodeParams, compileParamsToSlots } from "../src/utils/templateCompiler";
import { applyFieldRows } from "../src/nodes/logic/editFields";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const snapshot = (scope = owner, revision = "1", risk = 5) => freezeVariableSnapshot({ schemaVersion: 1, owner: scope, revision, loadedAt: Date.now(), entries: [
  { key: "BASE_RISK", value: risk, value_type: "number", updated_at: new Date().toISOString() },
  { key: "SYMBOL", value: "AAPL", value_type: "string", updated_at: new Date().toISOString() },
  { key: "EMPTY", value: null, value_type: "null", updated_at: new Date().toISOString() },
  { key: "ENABLED", value: true, value_type: "boolean", updated_at: new Date().toISOString() },
] }, scope);
const context = () => ({ $json: {}, $vars: snapshot().values });

describe("read-only workflow variables", () => {
  test.each(["$vars.BASE_RISK", '$vars["BASE_RISK"]'])("typed numeric root %s", source => expect(evaluateExpression(source, context())).toBe(5));
  test("interpolation, arithmetic, null and booleans retain types", () => {
    expect(resolveReferences("{{ $vars.BASE_RISK * 2 }}", {}, {}, [], snapshot().values)).toBe(10);
    expect(resolveReferences("Trade {{ $vars.SYMBOL }}", {}, {}, [], snapshot().values)).toBe("Trade AAPL");
    expect(evaluateExpression("$vars.EMPTY", context())).toBeNull();
    expect(evaluateExpression("$vars.ENABLED", context())).toBe(true);
    expect(() => resolveReferences("{{ $vars.BASE_RISK / 0 }}", {}, {}, [], snapshot().values)).toThrow();
  });
  test("missing variables and getters cannot silently evaluate", () => {
    expect(() => evaluateExpression("$vars.MISSING", context())).toThrow("Variable unavailable");
    const getter = jest.fn();
    const values = Object.defineProperty({}, "BASE_RISK", { get: getter });
    expect(() => evaluateExpression("$vars.BASE_RISK", { $json: {}, $vars: values })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test.each(["$vars", "$vars.__proto__", "$vars.constructor", '$vars["prototype"]', "$vars.BASE_RISK = 7", "$vars.SYMBOL.toLowerCase()"])("rejects unsafe expression %s", source => expect(() => evaluateExpression(source, context())).toThrow());
  test.each([{}, [], Infinity, NaN, undefined])("rejects non-scalar value %p", value => expect(() => validateVariable("VALUE", value)).toThrow());
  test.each(["__proto__", "constructor", "prototype", "1invalid", "x".repeat(65)])("rejects key %s", key => expect(() => validateVariable(key, 1)).toThrow());
  test("snapshot is immutable and owner-checked", () => {
    const pinned = snapshot();
    expect(Object.isFrozen(pinned.values)).toBe(true);
    expect(Object.isFrozen(pinned.entries[0])).toBe(true);
    expect(() => freezeVariableSnapshot(pinned, other)).toThrow();
    expect(() => validateVariable("TEXT", "x".repeat(4097))).toThrow();
    expect(referencesVariables({ value: "{{ $vars.BASE_RISK }}", __fieldValueModes: { value: "fixed" } })).toBe(false);
    expect(referencesVariables("{{ '$vars.BASE_RISK' }}")).toBe(false);
  });
  test("typed Edit Fields and generic server resolution agree, including computed bounds", () => {
    const expression = "{{ $json.data[-$vars.BASE_RISK:] }}";
    const input = { data: [0, 1, 2, 3, 4, 5, 6] };
    const typed = evaluateEditTemplate(compileEditTemplate(expression, TYPED_EXPRESSION_FEATURES), { $json: input, $vars: snapshot().values });
    const node: any = { id: "Compute", values: { value: expression } };
    const resolved = new ParameterResolver([node]).resolve(node, input, () => ({}), snapshot().values);
    expect(resolved.value).toEqual(typed);
    expect(typed).toEqual([2, 3, 4, 5, 6]);
    const fields = [{ fieldName: "risk", dataType: "number" as const, valueMode: "expression" as const, value: "{{ $vars.BASE_RISK }}" }];
    expect(applyFieldRows(fields, { input: {}, context: { $vars: snapshot().values }, legacyResultSeed: {} })).toMatchObject({ risk: 5 });
    node.values.__fieldValueModes = { value: "fixed" };
    expect(new ParameterResolver([node]).resolve(node, input, () => ({}), snapshot().values).value).toBe(expression);
  });
  test("typed variable rows force backtests onto the snapshot-aware runtime path", () => {
    const fields = [{ fieldName: "risk", dataType: "number", valueMode: "expression", value: "{{ $vars.BASE_RISK }}" }];
    const node: any = { id: "edit", name: "Edit Fields", values: { fields } };
    const compiled = compileNodeParams(node, [node]);
    expect(compiled.fallbackKeys).toEqual(["fields"]);
    expect(compileParamsToSlots(compiled, new Map())).toBeNull();
    const resolved = new ParameterResolver([node]).resolve(node, {}, () => ({}), snapshot().values);
    expect(resolved.fields).toEqual(fields);
    expect(applyFieldRows(resolved.fields, { input: {}, context: { $vars: snapshot().values }, legacyResultSeed: {} })).toMatchObject({ risk: 5 });
    node.values.fields[0].valueMode = "fixed";
    expect(compileNodeParams(node, [node]).fallbackKeys).toBeUndefined();
  });
  test("shared plans do not overwrite another run's resolved variables", () => {
    const node: any = { id: "Compute", values: { value: "{{ $vars.BASE_RISK }}" } };
    const resolver = new ParameterResolver([node]);
    const first = resolver.resolve(node, {}, () => ({}), snapshot(owner, "1", 5).values);
    const second = resolver.resolve(node, {}, () => ({}), snapshot(owner, "2", 10).values);
    expect(first.value).toBe(5); expect(second.value).toBe(10);
  });
});

