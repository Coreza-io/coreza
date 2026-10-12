const mockRedis = { xgroup: jest.fn(), xautoclaim: jest.fn(), xreadgroup: jest.fn(), xack: jest.fn() };
const mockEngine = { initialize: jest.fn(), getGraph: () => ({ entryNodeIds: ["trigger"], getOutgoingEdges: () => [{ target: "edit" }] }), resetForNextBar: jest.fn(), setRunId: jest.fn(), setVariableEventId: jest.fn(), preloadResults: jest.fn(), executeFromEntries: jest.fn(), variableRevision: "2" };
const mockCreateRun = jest.fn(); const mockUpdateRun = jest.fn(); const mockHset = jest.fn();
jest.mock("../src/config/redis", () => ({ createDedicatedStreamConnection: () => mockRedis }));
jest.mock("../src/engine", () => ({ WorkflowEngine: class { constructor() { return mockEngine; } } }));
jest.mock("../src/simulation/PortfolioManager", () => ({ PortfolioManager: {} }));
jest.mock("../src/utils/redisRunStorage", () => ({ createRunInRedis: mockCreateRun, updateRunStatusInRedis: mockUpdateRun }));
jest.mock("../src/infra/redisOps", () => ({ RedisOps: { hset: mockHset } }));
import { WorkflowRunner } from "../src/services/WorkflowRunner";
beforeEach(() => { jest.clearAllMocks(); mockEngine.initialize.mockResolvedValue(undefined); mockEngine.executeFromEntries.mockResolvedValue({ success: true }); mockCreateRun.mockResolvedValue(undefined); mockUpdateRun.mockResolvedValue(undefined); mockRedis.xack.mockResolvedValue(1); });
test("failed initialization prevents consumer-group creation, reclaim and polling", async () => {
  mockEngine.initialize.mockRejectedValue(new Error("SQL down"));
  const runner = new WorkflowRunner("workflow", "owner", [], [], "worker");
  await expect(runner.start()).rejects.toThrow("SQL down");
  expect(mockRedis.xgroup).not.toHaveBeenCalled(); expect(mockRedis.xautoclaim).not.toHaveBeenCalled(); expect(mockRedis.xreadgroup).not.toHaveBeenCalled();
});
test("live event and reclaim use stable identity and retain only revision metadata", async () => {
  const runner: any = new WorkflowRunner("workflow", "owner", [], [], "worker");
  const fields = ["event", JSON.stringify({ type: "bar", data: { close: 10 } })];
  await runner.processMessage("123-0", fields); await runner.processMessage("123-0", fields);
  expect(mockEngine.setVariableEventId.mock.calls[0][0]).toBe(mockEngine.setVariableEventId.mock.calls[1][0]);
  expect(mockEngine.setVariableEventId.mock.calls[0][0]).toContain("123-0");
  expect(mockEngine.executeFromEntries).toHaveBeenCalledWith({ data: { close: 10 } }, ["edit"]);
  expect(mockHset).toHaveBeenCalledWith(expect.any(String), { variable_revision: "2" });
  expect(mockRedis.xack).toHaveBeenCalledTimes(2);
});
test("failed persistent Edit result records failure and acknowledges without claiming success", async () => {
  mockEngine.executeFromEntries.mockResolvedValue({ success: false, error: { message: "Persistent commit rejected" } });
  const runner: any = new WorkflowRunner("workflow", "owner", [], [], "worker");
  await runner.processMessage("124-0", ["event", JSON.stringify({ data: { close: 10 } })]);
  expect(mockUpdateRun).toHaveBeenCalledWith("owner", expect.any(String), "failed", { errorMessage: "Persistent commit rejected" });
  expect(mockUpdateRun.mock.calls.some(call => call[2] === "success")).toBe(false);
  expect(mockRedis.xack).toHaveBeenCalledTimes(1);
});
