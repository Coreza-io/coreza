jest.mock("../src/config/supabase", () => ({ supabase: {} }));
const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
jest.mock("../src/config/redis", () => ({ getRedisCache: () => mockCache }));
import { VariableSnapshotService } from "../src/variables/VariableSnapshotService";
import { freezeVariableSnapshot, validateVariable, referencesVariables } from "../src/variables/contract";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES, evaluateExpression } from "../src/nodes/logic/safeExpression";
import { resolveReferences } from "../src/utils/resolveReferences";
import { ParameterResolver } from "../src/engine/parameterResolver";
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
  test("shared plans do not overwrite another run's resolved variables", () => {
    const node: any = { id: "Compute", values: { value: "{{ $vars.BASE_RISK }}" } };
    const resolver = new ParameterResolver([node]);
    const first = resolver.resolve(node, {}, () => ({}), snapshot(owner, "1", 5).values);
    const second = resolver.resolve(node, {}, () => ({}), snapshot(owner, "2", 10).values);
    expect(first.value).toBe(5); expect(second.value).toBe(10);
  });
});

describe("revisioned snapshot cache", () => {
  let repository: any;
  beforeEach(() => {
    process.env.WORKFLOW_VARIABLES_ENABLED = "true";
    jest.clearAllMocks();
    mockCache.get.mockResolvedValue(null); mockCache.set.mockResolvedValue("OK"); mockCache.del.mockResolvedValue(1);
    repository = { revision: jest.fn().mockResolvedValue("1"), snapshot: jest.fn().mockResolvedValue(snapshot()), mutate: jest.fn().mockResolvedValue({ revision: "2" }) };
  });
  afterAll(() => { delete process.env.WORKFLOW_VARIABLES_ENABLED; });
  test("misses coalesce and hits avoid SQL payload fetch", async () => {
    const service = new VariableSnapshotService(repository);
    const loaded = await Promise.all([service.load(owner), service.load(owner)]);
    expect(repository.snapshot).toHaveBeenCalledTimes(1);
    mockCache.get.mockResolvedValue(JSON.stringify(loaded[0]));
    await service.load(owner);
    expect(repository.snapshot).toHaveBeenCalledTimes(1);
    expect(repository.revision).toHaveBeenCalledTimes(3);
  });
  test("Redis failure falls back to SQL, DB revision failure fails closed", async () => {
    mockCache.get.mockRejectedValue(new Error("down")); mockCache.set.mockRejectedValue(new Error("down"));
    expect((await new VariableSnapshotService(repository).load(owner)).values.BASE_RISK).toBe(5);
    repository.revision.mockRejectedValue(new Error("SQL unavailable"));
    mockCache.get.mockResolvedValue(JSON.stringify(snapshot()));
    await expect(new VariableSnapshotService(repository).load(owner)).rejects.toThrow("SQL unavailable");
  });
  test("poisoned owner, stale revision and malformed records never become snapshots", async () => {
    for (const cache of [JSON.stringify(snapshot(other)), JSON.stringify(snapshot(owner, "0")), "invalid json"]) {
      mockCache.get.mockResolvedValue(cache);
      expect((await new VariableSnapshotService(repository).load(owner)).owner).toBe(owner);
    }
    expect(repository.snapshot).toHaveBeenCalledTimes(3);
  });
  test("mutation commits before invalidation and pinned runs keep their values", async () => {
    const service = new VariableSnapshotService(repository);
    const pinned = await service.load(owner);
    await service.mutate(owner, "1", "update", "BASE_RISK", 10);
    expect(repository.mutate.mock.invocationCallOrder[0]).toBeLessThan(mockCache.del.mock.invocationCallOrder[0]);
    repository.revision.mockResolvedValue("2"); repository.snapshot.mockResolvedValue(snapshot(owner, "2", 10));
    expect((await service.load(owner)).values.BASE_RISK).toBe(10);
    expect(pinned.values.BASE_RISK).toBe(5);
  });
  test("ten thousand expression reads incur no I/O after initialization", async () => {
    const pinned = await new VariableSnapshotService(repository).load(owner);
    const compiled = compileEditTemplate("{{ $vars.BASE_RISK * 2 }}");
    const calls = { revision: repository.revision.mock.calls.length, snapshot: repository.snapshot.mock.calls.length, cache: mockCache.get.mock.calls.length };
    for (let i = 0; i < 10000; i++) expect(evaluateEditTemplate(compiled, { $json: {}, $vars: pinned.values })).toBe(10);
    expect(repository.revision).toHaveBeenCalledTimes(calls.revision);
    expect(repository.snapshot).toHaveBeenCalledTimes(calls.snapshot);
    expect(mockCache.get).toHaveBeenCalledTimes(calls.cache);
  });
});
