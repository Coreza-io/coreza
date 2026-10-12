const mockLoad = jest.fn();
const mockCommit = jest.fn();
jest.mock("../src/variables/VariableSnapshotService", () => ({ variableSnapshots: { load: mockLoad, commit: mockCommit } }));
jest.mock("../src/engine/nodeStoreV2", () => ({ NodeStoreV2: class {} }));
jest.mock("../src/engine/DataContext", () => ({ DataContextManager: { getInstance: () => ({ getContext: () => ({}), destroyContext: jest.fn() }) } }));
jest.mock("../src/engine/indicatorStateManager", () => ({ IndicatorStateManager: class { clearL1Cache() {} } }));
const mockRuntimes: any[] = [];
jest.mock("../src/engine/executionRuntime", () => {
  class Runtime {
    resetForNextBar = jest.fn(); releaseVariables = jest.fn();
    constructor(_graph: unknown, _store: unknown, _resolver: unknown, public options: any) { mockRuntimes.push(this); }
  }
  return { StandardExecutionRuntime: Runtime, BacktestExecutionRuntime: Runtime };
});
import { WorkflowRun } from "../src/engine/workflowRun";
import { freezeVariableSnapshot } from "../src/variables/contract";

const owner = "11111111-1111-4111-8111-111111111111";
const makeRun = (expression = "{{ $vars.RISK }}") => new WorkflowRun({ nodes: [{ id: "Compute", values: { value: expression } }], edges: [], nodeExecutorMap: new Map(), graph: {}, isBacktest: false, executionMode: "live" } as any,
  { executionId: "run", workflowId: "workflow", userId: owner, executionMode: "live" });
beforeEach(() => { jest.clearAllMocks(); mockRuntimes.length = 0; });
test("load once, preserve on full bar reset, release on stop, reload on restart", async () => {
  mockLoad.mockResolvedValue(freezeVariableSnapshot({ owner, revision: "1", schemaVersion: 1, loadedAt: Date.now(), entries: [{ key: "RISK", value: 5, value_type: "number", updated_at: "today" }] }, owner));
  const run = makeRun(); await Promise.all([run.initialize(), run.initialize()]);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockRuntimes[0].options.getVariables().RISK).toBe(5);
  for (let bar = 0; bar < 10000; bar++) run.resetForNextBar(true);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(run.variableRevision).toBe("1");
  run.destroy(); expect(mockRuntimes[0].options.getVariables()).toBeUndefined();
  const next = makeRun(); await next.initialize(); expect(mockLoad).toHaveBeenCalledTimes(2); next.destroy();
});
test("no variable reference has no startup I/O", async () => { const run = makeRun("{{ $json.value }}"); await run.initialize(); expect(mockLoad).not.toHaveBeenCalled(); run.destroy(); });
test("initialization failure rejects before stream execution", async () => { mockLoad.mockRejectedValue(new Error("database unavailable")); const run = makeRun(); await expect(run.initialize()).rejects.toThrow("database unavailable"); expect(mockRuntimes[0].options.getVariables()).toBeUndefined(); run.destroy(); });
test("stop during loading cannot attach a late snapshot", async () => {
  let resolve!: (snapshot: any) => void;
  mockLoad.mockReturnValue(new Promise(accept => { resolve = accept; }));
  const run = makeRun(); const initializing = run.initialize();
  await Promise.resolve(); run.destroy(); resolve({ revision: "1", values: { RISK: 5 } });
  await expect(initializing).rejects.toThrow("cancelled");
  expect(mockRuntimes[0].options.getVariables()).toBeUndefined();
});

test("persistent Edit initializes without a reference and publishes only committed snapshots", async () => {
  const before = freezeVariableSnapshot({ owner, workflowId: "workflow", revision: "1", schemaVersion: 1, loadedAt: Date.now(), entries: [{ key: "bonus", value: 10, value_type: "number", updated_at: "today" }] }, owner, "workflow");
  mockLoad.mockResolvedValue(before);
  const run = new WorkflowRun({ nodes: [{ id: "edit", name: "Edit Fields", values: { persistent: true, fields: [{ fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" }] } }], edges: [], nodeExecutorMap: new Map(), graph: {}, isBacktest: false, executionMode: "live" } as any,
    { executionId: "run", workflowId: "workflow", userId: owner, executionMode: "live" });
  await run.initialize(); expect(mockLoad).toHaveBeenCalledWith(owner, "workflow");
  let release!: (value: any) => void;
  mockCommit.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const options = mockRuntimes[0].options;
  const writing = options.commitVariables([{ key: "bonus", value: 0 }], "event-node");
  await Promise.resolve(); await Promise.resolve();
  expect(options.getVariables().bonus).toBe(10);
  release(freezeVariableSnapshot({ ...before, revision: "2", entries: [{ key: "bonus", value: 0, value_type: "number", updated_at: "today" }] }, owner, "workflow"));
  await writing; expect(options.getVariables().bonus).toBe(0); expect(run.variableRevision).toBe("2");
  for (let bar=0; bar<10000; bar++) run.resetForNextBar(true);
  expect(options.getVariables().bonus).toBe(0); expect(mockLoad).toHaveBeenCalledTimes(1);
  mockCommit.mockRejectedValue(new Error("SQL down"));
  await expect(options.commitVariables([{ key: "bonus", value: 1 }], "later-event")).rejects.toThrow("SQL down");
  expect(options.getVariables().bonus).toBe(0); run.destroy();
});
test("backtest persistent Edit uses an ephemeral snapshot overlay", async () => {
  mockLoad.mockResolvedValue(freezeVariableSnapshot({ owner, workflowId: "workflow", revision: "1", schemaVersion: 1, loadedAt: Date.now(), entries: [] }, owner, "workflow"));
  const run = new WorkflowRun({ nodes: [{ id: "compute", values: { value: "{{ $vars.bonus }}" } }], edges: [], nodeExecutorMap: new Map(), graph: {}, isBacktest: true, executionMode: "backtest" } as any,
    { executionId: "backtest", workflowId: "workflow", userId: owner, executionMode: "backtest" });
  await run.initialize(); mockRuntimes[0].options.commitVariables([{ key: "bonus", value: 0 }], "event");
  expect(mockRuntimes[0].options.getVariables().bonus).toBe(0); expect(mockCommit).not.toHaveBeenCalled(); run.destroy();
});
