import { freezeVariableSnapshot, overlayVariables } from "../src/variables/contract";
import { applyFieldRows, stagePersistentFields, type EditFieldRowV2 } from "../src/nodes/logic/editFields";
import { evaluateExpression } from "../src/nodes/logic/safeExpression";

const owner = "11111111-1111-4111-8111-111111111111";
const workflow = "33333333-3333-4333-8333-333333333333";
const snapshot = (workflowId = workflow, risk = 10, revision = "1") => freezeVariableSnapshot({ owner, workflowId, revision, schemaVersion: 1, loadedAt: Date.now(), entries: [{ key: "bonus", value: risk, value_type: "number", updated_at: "today" }] }, owner, workflowId);
const rows: EditFieldRowV2[] = [{ fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" }];

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
});
test("backtest overlay retains false/empty/negative values without changing durable revision", () => {
  const old = snapshot();
  const overlay = overlayVariables(old, [{ key: "enabled", value: false }, { key: "text", value: "" }, { key: "bonus", value: -1 }]);
  expect(overlay.values).toMatchObject({ bonus: -1, enabled: false, text: "" });
  expect(overlay.revision).toBe(old.revision); expect(old.values.bonus).toBe(10);
  expect(() => evaluateExpression("$vars.missing", { $json: {}, $vars: overlay.values })).toThrow("Variable unavailable");
});
