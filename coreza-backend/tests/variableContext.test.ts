const mockLoad = jest.fn();
jest.mock("../src/variables/EditorVariableService", () => ({ editorVariables: {
  authorize: async (_owner: string, workflowId: string, scope: unknown) => ({ workflowId, scope }),
  touch: (...args: unknown[]) => mockLoad(...args),
} }));
jest.mock("../src/middleware/jwtAuth", () => ({ requireAuth: (_req: unknown, res: any) => res.status(401).json({ error: "Authentication required" }) }));
import { variableContext } from "../src/middleware/variableContext";
import { UtilityExecutor } from "../src/nodes/executors/UtilityExecutor";

const row = (valueMode = "expression") => ({ fieldName: "risk", dataType: "string", valueMode, value: "{{ $vars.RISK }}" });
async function request(body: any, path = "/comparator/field", method = "POST", user: any = { id: "owner" }) {
  const req: any = { get: () => undefined, body: { workflowId: "workflow", variableRevision: "1", variableScope: { sessionId: "session", mode: "manual" }, ...body }, path, method, user };
  const res: any = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await variableContext(req, res, next);
  return { res, next };
}
beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue({ revision: "1", values: Object.freeze({ RISK: 5 }) });
});
test.each([
  [{ value: "{{ $vars.RISK }}" }, "/comparator/compute"],
  [{ fields: [row("fixed")] }, "/comparator/field"],
  [{ fields: [row()] }, "/unrelated"],
  [{ input: { value: "{{ $vars.RISK }}" } }, "/comparator/field"],
])("literal or unrelated body bypasses snapshots: %p", async (body, path) => {
  mockLoad.mockRejectedValue(new Error("SQL down / feature disabled"));
  const { res, next } = await request({ ...body, variableRevision: undefined }, path);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockLoad).not.toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});
test("typed expressions use only the authenticated owner's snapshot", async () => {
  const { res, next } = await request({ fields: [row()], user_id: "other" }, "/comparator/field/");
  expect(mockLoad).toHaveBeenCalledWith("owner", "workflow", expect.any(Object));
  expect(res.locals.variables).toEqual({ RISK: 5 });
  expect(next).toHaveBeenCalledTimes(1);
});
test("explicit revisions load snapshots for resolved generic actions", async () => {
  const { res, next } = await request({ value: 5, variableRevision: "1" }, "/comparator/compute");
  expect(mockLoad).toHaveBeenCalledWith("owner", "workflow", expect.any(Object));
  expect(res.locals.variables).toEqual({ RISK: 5 });
  expect(next).toHaveBeenCalledTimes(1);
});
test("revision conflicts fail closed", async () => {
  const { res, next } = await request({ variableRevision: "0" });
  expect(res.status).toHaveBeenCalledWith(409);
  expect(next).not.toHaveBeenCalled();
  expect(res.locals.variables).toBeUndefined();
});
test("snapshot failures fail closed for expression requests", async () => {
  mockLoad.mockRejectedValue(new Error("SQL down"));
  const { res, next } = await request({ fields: [row()] });
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});
test("unauthenticated expressions do not load a snapshot", async () => {
  const { res, next } = await request({ fields: [row()] }, undefined, undefined, null);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mockLoad).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
test.each(["Visualize", "httprequest"])("%s preserves resolved output without logging variable values", name => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  try {
    const secret = "sentinel-variable-value";
    const node: any = { id: "utility", name };
    const result = new UtilityExecutor().execute(node, {}, { resolveNodeParameters: () => ({ data: secret }) });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).toContain(secret);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  } finally { log.mockRestore(); }
});
