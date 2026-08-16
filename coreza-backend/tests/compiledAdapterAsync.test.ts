import { buildExecAdapter } from "../src/backtest/compiled/adapters";
import type { CompiledExecContext } from "../src/backtest/compiled/types";
import type { INodeExecutor, WorkflowNode } from "../src/nodes/types";

const node: WorkflowNode = {
  id: "store-1",
  name: "Store",
  node_type: "main",
  category: "DataSource",
};

const context = (isWarmingUp = false): CompiledExecContext =>
  ({ isWarmingUp } as CompiledExecContext);

describe("compiled executor adapter async opt-in", () => {
  it("resolves the real result from an async-declared executor", async () => {
    const executor: INodeExecutor = {
      category: "DataSource",
      syncCapable: false,
      execute: async () => ({ success: true, data: "stored" }),
    };

    await expect(
      buildExecAdapter(executor)(node, {}, {}, context()),
    ).resolves.toEqual({ success: true, data: "stored" });
  });

  it("rejects promises returned by a sync-declared executor", () => {
    const executor: INodeExecutor = {
      category: "Compute",
      syncCapable: true,
      execute: async () => ({ success: true }),
    };

    expect(buildExecAdapter(executor)(node, {}, {}, context())).toMatchObject({
      success: false,
      error: expect.stringContaining("requires synchronous executor"),
    });
  });

  it("returns a synchronous result without awaiting", () => {
    const result = { success: true, data: 42 };
    const executor: INodeExecutor = {
      category: "Compute",
      syncCapable: true,
      execute: () => result,
    };

    expect(buildExecAdapter(executor)(node, {}, {}, context())).toBe(result);
  });

  it("does not execute a suppressed async node during warm-up", async () => {
    const execute = jest.fn(async () => ({ success: true }));
    const executor: INodeExecutor = {
      category: "DataSource",
      syncCapable: false,
      execute,
    };

    await expect(
      buildExecAdapter(executor)(node, {}, {}, context(true)),
    ).resolves.toMatchObject({ success: true, warmupSuppressed: true });
    expect(execute).not.toHaveBeenCalled();
  });
});
