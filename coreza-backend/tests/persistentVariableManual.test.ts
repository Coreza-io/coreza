const mockLoad = jest.fn(); const mockCommit = jest.fn();
jest.mock("../src/variables/VariableSnapshotService", () => ({ variablesEnabled: () => true, variableSnapshots: { load: mockLoad, commit: mockCommit } }));
jest.mock("../src/middleware/jwtAuth", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: "owner" }; next(); } }));
import express from "express";
import request from "supertest";
import comparator from "../src/routes/comparator";
import { variableContext } from "../src/middleware/variableContext";
const app = express(); app.use(express.json()); app.use(variableContext); app.use("/comparator", comparator);
let server: import("http").Server;
beforeAll(done => { server = app.listen(0, "127.0.0.1", done); });
afterAll(done => { server.close(done); });
const row = { fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" };
const body = { workflowId: "workflow", persistent: true, fields: [row], variableRevision: "1", variableInvocationId: "33333333-3333-4333-8333-333333333333" };
beforeEach(() => { jest.clearAllMocks(); mockLoad.mockResolvedValue({ owner: "owner", workflowId: "workflow", revision: "1", values: { bonus: 10 } }); mockCommit.mockResolvedValue({ owner: "owner", workflowId: "workflow", revision: "2", values: { bonus: 0 } }); });
test("explicit manual/cluster Execute commits a batch and returns snapshot separately from node output", async () => {
  const response = await request(server).post("/comparator/field").send(body);
  expect(response.status).toBe(200); expect(response.body.data.bonus).toBe(0);
  expect(response.body.variableSnapshot.values.bonus).toBe(0);
  expect(mockCommit).toHaveBeenCalledWith(expect.objectContaining({ revision: "1", workflowId: "workflow" }), [{ key: "bonus", value: 0 }], body.variableInvocationId);
});
test("bad batch and missing invocation ID never write", async () => {
  let response = await request(server).post("/comparator/field").send({ ...body, fields: [row, { ...row, fieldName: "bad", value: "wrong" }] });
  expect(response.status).toBe(400); expect(mockCommit).not.toHaveBeenCalled();
  response = await request(server).post("/comparator/field").send({ ...body, variableInvocationId: undefined });
  expect(response.status).toBe(400); expect(mockCommit).not.toHaveBeenCalled();
});
test("persistent off reads no snapshot and writes nothing", async () => {
  const response = await request(server).post("/comparator/field").send({ workflowId: "workflow", persistent: false, fields: [row] });
  expect(response.status).toBe(200); expect(response.body.data.bonus).toBe(0);
  expect(mockLoad).not.toHaveBeenCalled(); expect(mockCommit).not.toHaveBeenCalled();
});
test("DB failure and revision conflict fail safely without publishing staged values", async () => {
  mockCommit.mockRejectedValue(Object.assign(new Error("SQL down"), { statusCode: 503 }));
  let response = await request(server).post("/comparator/field").send(body);
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined();
  mockLoad.mockResolvedValue({ revision: "2", values: { bonus: 10 } });
  mockCommit.mockClear(); response = await request(server).post("/comparator/field").send(body);
  expect(response.status).toBe(409); expect(mockCommit).not.toHaveBeenCalled();
});
