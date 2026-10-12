jest.mock("../src/config/supabase", () => ({ supabase: {} }));
const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
jest.mock("../src/config/redis", () => ({ getRedisCache: () => mockCache }));
import { VariableSnapshotService } from "../src/variables/VariableSnapshotService";
import { freezeVariableSnapshot, overlayVariables } from "../src/variables/contract";
import { stagePersistentFields } from "../src/variables/editFieldVariables";
import { applyFieldRows, type EditFieldRowV2 } from "../src/nodes/logic/editFields";
import { evaluateExpression } from "../src/nodes/logic/safeExpression";

const owner = "11111111-1111-4111-8111-111111111111";
const workflow = "33333333-3333-4333-8333-333333333333";
const otherWorkflow = "44444444-4444-4444-8444-444444444444";
const snapshot = (workflowId = workflow, risk = 10, revision = "1") => freezeVariableSnapshot({ owner, workflowId, revision, schemaVersion: 1, loadedAt: Date.now(), entries: [{ key: "bonus", value: risk, value_type: "number", updated_at: "today" }] }, owner, workflowId);
const rows: EditFieldRowV2[] = [{ fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" }];
beforeEach(() => { process.env.WORKFLOW_VARIABLES_ENABLED = "true"; jest.clearAllMocks(); mockCache.get.mockResolvedValue(null); mockCache.set.mockResolvedValue("OK"); mockCache.del.mockResolvedValue(1); });
afterAll(() => { delete process.env.WORKFLOW_VARIABLES_ENABLED; });

test("typed persistence stages zero rather than preferring an old value", () => {
  const setPersistentValue = jest.fn();
  const staged = stagePersistentFields(rows, { input: {}, legacyResultSeed: {}, legacyPersistentRead: true,
    context: { persistent: true, getPersistentValue: () => 10, setPersistentValue } });
  expect(staged.result.bonus).toBe(0);
  expect(staged.changes).toEqual([{ key: "bonus", value: 0 }]);
  expect(setPersistentValue).not.toHaveBeenCalled();
});
test.each(["array", "object"] as const)("rejects unsupported persisted %s before any writes", dataType => {
  expect(() => stagePersistentFields([{ ...rows[0], dataType, value: dataType === "array" ? "[]" : "{}" }], { input: {}, legacyResultSeed: {} })).toThrow("turn Persistent off");
});
test("invalid batch values, duplicates, missing/reserved names never reach storage callbacks", () => {
  const write = jest.fn();
  for (const invalid of [[...rows, { ...rows[0], fieldName: "second", value: "bad" }], [...rows, rows[0]], [{ ...rows[0], fieldName: "" }], [{ ...rows[0], fieldName: "__proto__" }]]) {
    expect(() => stagePersistentFields(invalid, { input: {}, legacyResultSeed: {}, context: { persistent: true, setPersistentValue: write } })).toThrow();
  }
  expect(write).not.toHaveBeenCalled();
});
test("Persistent off keeps ordinary typed output without any persistence writes", () => {
  const write = jest.fn();
  expect(applyFieldRows(rows, { input: {}, legacyResultSeed: {}, context: { persistent: false, setPersistentValue: write } })).toEqual({ bonus: 0 });
  expect(write).not.toHaveBeenCalled(); expect(mockCache.set).not.toHaveBeenCalled();
});
test("commit validates first, awaits SQL, invalidates optional cache, and preserves immutable snapshots", async () => {
  let release!: (value: any) => void;
  const repository: any = { commit: jest.fn(() => new Promise(resolve => { release = resolve; })) };
  const service = new VariableSnapshotService(repository);
  const old = snapshot();
  const committing = service.commit(old, [{ key: "bonus", value: 0 }], "event-node-1");
  expect(old.values.bonus).toBe(10);
  expect(mockCache.del).not.toHaveBeenCalled();
  release(snapshot(workflow, 0, "2"));
  const committed = await committing;
  expect(committed.values.bonus).toBe(0);
  expect(evaluateExpression("$vars.bonus", { $json: {}, $vars: committed.values })).toBe(0);
  expect(old.values.bonus).toBe(10);
  expect(Object.isFrozen(committed.values)).toBe(true);
  expect(repository.commit).toHaveBeenCalledWith(owner, workflow, "1", "event-node-1", [{ key: "bonus", value: 0 }]);
  expect(mockCache.del).toHaveBeenCalledTimes(1);
});
test("10,000 unchanged bars and expression reads do not write or read storage", async () => {
  const repository: any = { commit: jest.fn() };
  const service = new VariableSnapshotService(repository);
  const pinned = snapshot(workflow, 0);
  for (let bar = 0; bar < 10000; bar++) {
    expect(await service.commit(pinned, [{ key: "bonus", value: 0 }], `bar-${bar}`)).toBe(pinned);
    expect(evaluateExpression("$vars.bonus", { $json: {}, $vars: pinned.values })).toBe(0);
  }
  expect(repository.commit).not.toHaveBeenCalled(); expect(mockCache.get).not.toHaveBeenCalled(); expect(mockCache.del).not.toHaveBeenCalled();
});
test("SQL conflicts/outages expose no new snapshot; Redis outage does not undo SQL success", async () => {
  const repository: any = { commit: jest.fn().mockRejectedValue(new Error("revision conflict")) };
  const service = new VariableSnapshotService(repository); const old = snapshot();
  await expect(service.commit(old, [{ key: "bonus", value: 0 }], "token")).rejects.toThrow("conflict");
  expect(old.values.bonus).toBe(10); expect(mockCache.del).not.toHaveBeenCalled();
  repository.commit.mockResolvedValue(snapshot(workflow, 0, "2")); mockCache.del.mockRejectedValue(new Error("Redis down"));
  expect((await service.commit(old, [{ key: "bonus", value: 0 }], "token")).values.bonus).toBe(0);
});
test("cache keys and validation isolate workflows belonging to the same owner", async () => {
  const repository: any = { revision: jest.fn().mockResolvedValue("1"), snapshot: jest.fn((_owner, id) => Promise.resolve(snapshot(id, id === workflow ? 10 : 20))) };
  const service = new VariableSnapshotService(repository);
  const first = await service.load(owner, workflow); const second = await service.load(owner, otherWorkflow);
  expect(first.values.bonus).toBe(10); expect(second.values.bonus).toBe(20);
  expect(mockCache.get.mock.calls[0][0]).not.toEqual(mockCache.get.mock.calls[1][0]);
  mockCache.get.mockResolvedValue(JSON.stringify(first));
  expect((await service.load(owner, otherWorkflow)).values.bonus).toBe(20);
  expect(() => freezeVariableSnapshot(first, owner, otherWorkflow)).toThrow();
});
test("backtest overlay retains false/empty/negative values without changing durable revision", () => {
  const old = snapshot();
  const overlay = overlayVariables(old, [{ key: "enabled", value: false }, { key: "text", value: "" }, { key: "bonus", value: -1 }]);
  expect(overlay.values).toMatchObject({ bonus: -1, enabled: false, text: "" });
  expect(overlay.revision).toBe(old.revision); expect(old.values.bonus).toBe(10);
  expect(() => evaluateExpression("$vars.missing", { $json: {}, $vars: overlay.values })).toThrow("Variable unavailable");
});
