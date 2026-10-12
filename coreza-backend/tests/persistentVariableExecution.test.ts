jest.mock("../src/nodes/registry", () => ({ getNodeExecutor: jest.fn() }));
jest.mock("../src/nodes/executors/LoopExecutorV2", () => ({ LoopExecutorV2: class {} }));
import { StandardExecutionRuntime } from "../src/engine/executionRuntime";
import { GraphRuntime } from "../src/engine/graphRuntime";
import { ParameterResolver } from "../src/engine/parameterResolver";
import { ControlFlowExecutor } from "../src/nodes/executors/ControlFlowExecutor";
import { compileNodeParams, compileParamsToSlots } from "../src/utils/templateCompiler";

function fixture(mode: "best-effort" | "fail-fast" = "best-effort", persistent = true) {
  const edit: any = { id: "edit", name: "Edit Fields", node_type: "main", category: "ControlFlow", values: { persistent, fields: [{ fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" }] } };
  const trade: any = { id: "trade", name: "Trade", node_type: "main", category: "Broker", values: { bonus: "{{ $vars.bonus }}" } };
  const nodes = [edit, trade]; const edges = [{ id: "edge", source: "edit", target: "trade" }];
  let values: Readonly<{ bonus: number }> = Object.freeze({ bonus: 10 });
  const commit = jest.fn((_changes: any, _token: string): void | Promise<void> => { values = Object.freeze({ bonus: 0 }); });
  const executeTrade = jest.fn((node, input, context) => ({ success: true, data: context.resolveNodeParameters(node, input) }));
  const results: Record<string, any> = {};
  const store: any = { getAllResults: () => results, setNodeResult: (id: string, result: any) => { results[id] = result; }, setNodeError: jest.fn(), clearResults: () => Object.keys(results).forEach(key => delete results[key]) };
  const runtime = new StandardExecutionRuntime(new GraphRuntime(nodes, edges), store, new ParameterResolver(nodes), {
    nodes, edges, executionId: "worker", workflowId: "workflow", userId: "owner", executionMode: "live", mode,
    dataContext: {} as any, indicatorStateManager: {} as any, getVariables: () => values, commitVariables: commit,
    nodeExecutorMap: new Map<string, any>([["edit", new ControlFlowExecutor()], ["trade", { category: "Broker", execute: executeTrade }]]),
  });
  return { runtime, commit, executeTrade, edit, results, getValues: () => values };
}
test("later nodes see committed zero in the same event", async () => {
  const f = fixture(); await f.runtime.executeOnce({ nodeId: "edit", input: {} });
  expect(f.results.edit.data.bonus).toBe(0); await f.runtime.executeOnce(f.runtime.dequeue()!);
  expect(f.results.trade.data.bonus).toBe(0);
});
test("Edit does not route output until the asynchronous commit completes", async () => {
  const f = fixture(); let release!: () => void;
  f.commit.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const writing = f.runtime.executeOnce({ nodeId: "edit", input: {} });
  expect(f.runtime.hasPending()).toBe(false); expect(f.results.edit).toBeUndefined();
  release(); await writing; expect(f.runtime.hasPending()).toBe(true);
});
test.each(["best-effort", "fail-fast"] as const)("DB failure blocks trading even in %s mode", async mode => {
  const f = fixture(mode); f.commit.mockImplementation(() => { throw new Error("SQL down"); });
  await expect(Promise.resolve().then(() => f.runtime.executeOnce({ nodeId: "edit", input: {} }))).rejects.toThrow("SQL down");
  expect(f.executeTrade).not.toHaveBeenCalled(); expect(f.runtime.hasPending()).toBe(false);
  expect(f.results.edit.success).toBe(false); expect(f.getValues().bonus).toBe(10);
});
test("invalid field in a batch causes no commit or downstream execution", () => {
  const f = fixture(); f.edit.values.fields.push({ fieldName: "bad", dataType: "number", valueMode: "fixed", value: "wrong" });
  expect(() => f.runtime.executeOnce({ nodeId: "edit", input: {} })).toThrow("invalid fixed value");
  expect(f.commit).not.toHaveBeenCalled(); expect(f.executeTrade).not.toHaveBeenCalled();
});
test("Persistent off avoids storage; persistent backtests cannot use the compiled VM", async () => {
  const f = fixture(); expect(compileParamsToSlots(compileNodeParams(f.edit, [f.edit]), new Map())).toBeNull();
  const off = fixture("best-effort", false); await off.runtime.executeOnce({ nodeId: "edit", input: {} });
  expect(off.commit).not.toHaveBeenCalled(); expect(off.results.edit.data.bonus).toBe(0);
});
test("reclaims reuse event/node/invocation tokens independently of random run IDs", async () => {
  const f = fixture(); f.runtime.setExecutionContextExtras({ variableEventId: "stream:123-0", runId: "random-first" });
  await f.runtime.executeOnce({ nodeId: "edit", input: {} }); const first = f.commit.mock.calls[0][1];
  f.runtime.resetForNextBar(true); f.runtime.setExecutionContextExtras({ variableEventId: "stream:123-0", runId: "random-reclaimed" });
  await f.runtime.executeOnce({ nodeId: "edit", input: {} }); expect(f.commit.mock.calls[1][1]).toBe(first);
  f.runtime.resetForNextBar(true); f.runtime.setExecutionContextExtras({ variableEventId: "stream:124-0" });
  await f.runtime.executeOnce({ nodeId: "edit", input: {} }); expect(f.commit.mock.calls[2][1]).not.toBe(first);
});
test("variable-dependent loops reject distributed execution before handing off an unpinned child context", async () => {
  await expect(new ControlFlowExecutor().execute({ id: "loop", name: "Loop", values: { parallel: true } } as any, {}, {
    variables: Object.freeze({ bonus: 0 }), getState: () => undefined,
  })).rejects.toThrow("sequential Loop");
});
