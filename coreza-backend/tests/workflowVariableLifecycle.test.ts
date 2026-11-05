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

const owner = "11111111-1111-4111-8111-111111111111";
const makeRun = (expression = "{{ $vars.RISK }}") => new WorkflowRun({ nodes: [{ id: "Compute", values: { value: expression } }], edges: [], nodeExecutorMap: new Map(), graph: {}, isBacktest: false, executionMode: "live" } as any,
  { executionId: "run", workflowId: "workflow", userId: owner, executionMode: "live" });
beforeEach(() => { jest.clearAllMocks(); mockRuntimes.length = 0; });
test("registry exists only after commit, survives bars, and is released on stop", async () => {
  const run = makeRun(); await run.initialize();
  const options = mockRuntimes[0].options;
  expect(options.getVariables()).toBeUndefined();
  options.commitVariables([{ key: "RISK", value: 5 }], "event");
  expect(options.getVariables().RISK).toBe(5);
  run.resetForNextBar(true);
  expect(options.getVariables().RISK).toBe(5);
  run.destroy(); expect(options.getVariables()).toBeUndefined();
  const next = makeRun(); await next.initialize();
  expect(mockRuntimes[1].options.getVariables()).toBeUndefined(); next.destroy();
});
test("an invalid first commit creates no registry", async () => {
  const run = makeRun(); await run.initialize();
  const options = mockRuntimes[0].options;
  expect(() => options.commitVariables([{ key: "RISK", value: {} }], "event")).toThrow();
  expect(options.getVariables()).toBeUndefined(); run.destroy();
});
