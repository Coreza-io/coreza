import type { Edge, Node } from "@xyflow/react";
import ExecutionContext from "@/utils/executionContext";
import { WorkflowExecutor, type ExecutorContext } from "@/utils/workflowExecutor";
import {
  acquireEditorExecutionLock,
  clearEditorNodeActions,
  isEditorExecutionLocked,
  registerEditorNodeAction,
  releaseEditorExecutionLock,
  type EditorNodeAction,
} from "@/services/editorNodeExecution";

const session = "execute-all-test";
const node = (id: string, nodeType = "action", name = id): Node => ({
  id, position: { x: 0, y: 0 },
  data: { definition: { name, node_type: nodeType }, workflowSessionId: session },
});
const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`, source, target,
});

function setup(nodes: Node[], edges: Edge[]) {
  const store = new ExecutionContext();
  const calls: string[] = [];
  const context: ExecutorContext = {
    nodes, edges, executionStore: store,
    setNodes: (update) => { context.nodes = update(context.nodes); },
    setEdges: (update) => { context.edges = update(context.edges); },
    setExecutingNode: jest.fn(), toast: jest.fn(),
  };
  const action = (id: string, run?: EditorNodeAction) => {
    registerEditorNodeAction(session, id, async (request) => {
      calls.push(id);
      return run ? run(request) : { nodeId: id, status: "success", output: id };
    });
  };
  nodes.forEach((n) => action(n.id));
  const executor = new WorkflowExecutor(context);
  // Match the editor button's existing lock ownership and finally contract.
  const run = async () => {
    const token = acquireEditorExecutionLock(session);
    if (!token) throw new Error("Editor is still locked");
    try { await executor.executeAllNodes(token); }
    finally { releaseEditorExecutionLock(session, token); }
  };
  return { store, calls, context, action, executor, run };
}

describe("Execute All failure handling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    clearEditorNodeActions(session);
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const finish = async (run: Promise<void>) => {
    await jest.runAllTimersAsync();
    await run;
  };
  const expectFailure = (context: ExecutorContext, id: string, message: string) => {
    expect(context.toast).toHaveBeenCalledTimes(1);
    expect(context.toast).toHaveBeenCalledWith({
      title: "Workflow execution stopped due to an error",
      description: `Execution stopped at node ${id}: ${message}`,
      variant: "destructive",
    });
  };

  it("stops queued roots on a structured node failure", async () => {
    const h = setup([node("failed", "trigger"), node("queued", "trigger")], []);
    h.action("failed", async () => ({
      nodeId: "failed", status: "failed", error: { message: "Required field missing" },
    }));
    await finish(h.run());
    expect(h.calls).toEqual(["failed"]);
    expectFailure(h.context, "failed", "Required field missing");
  });

  it("stops siblings and descendants, preserves outputs and inline errors, and allows retry", async () => {
    const h = setup(
      [node("init", "backtest"), node("bar", "action", "OnBar"), node("sibling"), node("child")],
      [edge("init", "bar"), edge("init", "sibling"), edge("bar", "child")],
    );
    h.store.setNodeData("bar", { output: "previous preview" });
    h.store.setPinned("child", "pinned preview");
    h.action("bar", async () => {
      h.context.nodes = h.context.nodes.map((n) => n.id === "bar"
        ? { ...n, data: { ...n.data, error: "Backtest ID is required" } } : n);
      return { nodeId: "bar", status: "failed", error: { message: "Backtest ID is required" } };
    });
    await finish(h.run());
    expect(h.calls).toEqual(["init", "bar"]);
    expectFailure(h.context, "bar", "Backtest ID is required");
    expect(h.store.getNodeData("init").output).toBe("init");
    expect(h.store.getNodeData("bar").output).toBe("previous preview");
    expect(h.store.getNodeData("child").output).toBe("pinned preview");
    expect(h.context.nodes.find((n) => n.id === "bar")?.data.error).toBe("Backtest ID is required");
    expect(h.executor.getIsAutoExecuting()).toBe(false);
    expect(h.context.setExecutingNode).toHaveBeenLastCalledWith(null);
    expect(h.context.edges.every((e) => !e.animated && e.className === "")).toBe(true);
    expect(isEditorExecutionLocked(session)).toBe(false);

    h.action("bar");
    h.calls.length = 0;
    (h.context.toast as jest.Mock).mockClear();
    await finish(h.run());
    expect(h.calls).toEqual(["init", "bar", "sibling", "child"]);
    expect(h.context.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Workflow Execution Complete",
    }));
  });

  it.each([1, 2])("stops later OnBar iterations after a body failure on bar %s", async (failAt) => {
    const h = setup(
      [node("init", "backtest"), node("bar", "action", "OnBar"), node("body"), node("sibling")],
      [edge("init", "bar"), edge("bar", "body"), edge("bar", "sibling")],
    );
    let bars = 0;
    h.action("bar", async () => ({
      nodeId: "bar", status: "success", output: { data: { isLast: ++bars === 3 } },
    }));
    h.action("body", async () => {
      if (bars === failAt) throw new Error("Body failed");
      return { nodeId: "body", status: "success" };
    });
    await finish(h.run());
    expect(bars).toBe(failAt);
    expect(h.calls.filter((id) => id === "sibling")).toHaveLength(failAt - 1);
    expectFailure(h.context, "body", "Body failed");
  });

  it.each(["subscription failed", null])("normalizes a thrown value %s and prevents Loop feedback", async (error) => {
    const h = setup(
      [node("root", "trigger"), { ...node("loop", "action", "Loop"), type: "Loop" }, node("body")],
      [edge("root", "loop"), edge("loop", "body"), edge("body", "loop")],
    );
    h.action("body", async () => { throw error; });
    await finish(h.run());
    expect(h.calls).toEqual(["root", "loop", "body"]);
    expectFailure(h.context, "body", String(error));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Node body failed"), error);
  });

  it("keeps manual Stop neutral and does not start queued work", async () => {
    const h = setup([node("root", "trigger"), node("queued", "trigger")], []);
    h.action("root", async () => {
      h.executor.stop();
      return { nodeId: "root", status: "success", output: "completed" };
    });
    await finish(h.run());
    expect(h.calls).toEqual(["root"]);
    expect(h.context.toast).toHaveBeenCalledWith({
      title: "Workflow execution stopped", description: "1 nodes completed before stop",
    });
  });

  it("stops queued work when the normal action times out", async () => {
    const h = setup([node("slow", "trigger"), node("queued", "trigger")], []);
    h.action("slow", () => new Promise(() => {}));
    await finish(h.run());
    expect(h.calls).toEqual(["slow"]);
    expectFailure(h.context, "slow", "Node slow execution timed out after 30s");
  });

  it("stops queued work when a streaming subscription fails", async () => {
    const streaming = node("stream", "trigger");
    streaming.data.definition = {
      name: "Stream", node_type: "trigger", executionMode: "streaming",
    };
    const h = setup([streaming, node("queued", "trigger")], []);
    h.action("stream", async () => { throw new Error("Subscription failed"); });
    await finish(h.run());
    expect(h.calls).toEqual(["stream"]);
    expectFailure(h.context, "stream", "Subscription failed");
  });
});
