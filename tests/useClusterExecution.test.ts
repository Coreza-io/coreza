import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Edge, Node } from "@xyflow/react";
import {
  buildClusterExecutionPlan,
  useClusterExecution,
  type ClusterRunState,
} from "@/hooks/useClusterExecution";
import { registerEditorNodeAction } from "@/services/editorNodeExecution";

const node = (id: string, values: Record<string, unknown> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: { name: id, node_type: "action", manualExecution: "available" }, values, workflowSessionId: "session" },
});

describe("manual cluster execution", () => {
  const clusterId = "00000000-0000-4000-8000-000000000001";
  it("orders main edges and internal expression references deterministically", () => {
    const nodes = [node("third", { value: "{{$node['second'].value}}" }), node("first"), node("second")];
    const edges: Edge[] = [{ id: "one-two", source: "first", target: "second" }];
    expect(buildClusterExecutionPlan(
      { id: clusterId, title: "Folder", memberNodeIds: ["third", "first", "second"] },
      nodes,
      edges,
    ).executableNodeIds).toEqual(["first", "second", "third"]);
  });

  it("includes an unwired eligible member once in deterministic membership order", () => {
    const nodes = [node("first"), node("unwired"), node("second")];
    const plan = buildClusterExecutionPlan(
      { id: clusterId, title: "Folder", memberNodeIds: ["first", "unwired", "second"] },
      nodes,
      [{ id: "first-second", source: "first", target: "second" }],
    );
    expect(plan.executableNodeIds).toEqual(["first", "unwired", "second"]);
  });

  it("rejects cycles before executing any node", () => {
    const nodes = [node("one"), node("two")];
    const edges: Edge[] = [
      { id: "a", source: "one", target: "two" },
      { id: "b", source: "two", target: "one" },
    ];
    expect(() => buildClusterExecutionPlan(
      { id: clusterId, title: "Folder", memberNodeIds: ["one", "two"] }, nodes, edges,
    )).toThrow("cyclic");
  });

  it("orders a supported Loop return boundary without treating it as a generic cycle", () => {
    const loop = node("loop");
    loop.data = { ...loop.data, definition: { name: "Loop", node_type: "action", manualExecution: "available", handles: [{ id: "loop", type: "source", connectionKind: "main" }] } };
    const nodes = [loop, node("body")];
    const edges: Edge[] = [
      { id: "loop-body", source: "loop", sourceHandle: "loop", target: "body" },
      { id: "body-loop", source: "body", target: "loop" },
    ];
    expect(buildClusterExecutionPlan(
      { id: clusterId, title: "Loop folder", memberNodeIds: ["loop", "body"] }, nodes, edges,
    ).executableNodeIds).toEqual(["loop", "body"]);
  });

  it("preserves ordinary prerequisites entering a Loop and removes only feedback", () => {
    const loop = node("loop");
    loop.data = { ...loop.data, definition: { name: "Loop", node_type: "action", manualExecution: "available", handles: [{ id: "loop", type: "source", connectionKind: "main" }] } };
    const nodes = [loop, node("body"), node("upstream")];
    const edges: Edge[] = [
      { id: "upstream-loop", source: "upstream", target: "loop" },
      { id: "loop-body", source: "loop", sourceHandle: "loop", target: "body" },
      { id: "body-loop", source: "body", target: "loop" },
    ];
    expect(buildClusterExecutionPlan(
      { id: clusterId, title: "Loop folder", memberNodeIds: ["loop", "body", "upstream"] }, nodes, edges,
    ).executableNodeIds).toEqual(["upstream", "loop", "body"]);
  });

  it("does not use attachment edges for dependency ordering", () => {
    const owner = node("owner");
    owner.data = { ...owner.data, definition: { name: "owner", node_type: "action", manualExecution: "available", handles: [{ id: "tool", type: "target", connectionKind: "attachment" }] } };
    const attachment = node("attachment");
    attachment.data = { ...attachment.data, definition: { name: "attachment", node_type: "sub", manualExecution: "attachment", handles: [{ id: "out", type: "source", connectionKind: "attachment" }] } };
    expect(buildClusterExecutionPlan(
      { id: clusterId, title: "Folder", memberNodeIds: ["owner", "attachment"] },
      [owner, attachment],
      [{ id: "attachment", source: "attachment", sourceHandle: "out", target: "owner", targetHandle: "tool" }],
    ).executableNodeIds).toEqual(["owner"]);
  });

  it.each([
    ["loop", ["loop", "body"]],
    ["done", ["loop", "done"]],
  ])("executes only the %s continuation of a manual Loop step", async (continuation, expectedCalls) => {
    const calls: string[] = [];
    registerEditorNodeAction("session", "loop", async () => {
      calls.push("loop");
      return { nodeId: "loop", status: "success", selectedContinuation: continuation };
    });
    for (const id of ["body", "done"]) {
      registerEditorNodeAction("session", id, async () => {
        calls.push(id);
        return { nodeId: id, status: "success" };
      });
    }
    const loop = node("loop");
    loop.data = {
      ...loop.data,
      definition: {
        name: "Loop",
        node_type: "action", manualExecution: "available",
        handles: [
          { id: "loop", type: "source", connectionKind: "main" },
          { id: "done", type: "source", connectionKind: "main" },
        ],
      },
    };
    const nodes = [loop, node("body"), node("done")];
    const edges: Edge[] = [
      { id: "loop-body", source: "loop", sourceHandle: "loop", target: "body" },
      { id: "body-loop", source: "body", target: "loop" },
      { id: "loop-done", source: "loop", sourceHandle: "done", target: "done" },
    ];
    let execute!: (id: string) => Promise<void>;
    function Harness() {
      execute = useClusterExecution({
        workflowSessionId: "session",
        nodes,
        edges,
        clusters: [{ id: clusterId, title: "Loop folder", memberNodeIds: ["loop", "body", "done"] }],
      }).executeCluster;
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(React.createElement(Harness)); });
    await act(async () => execute(clusterId));
    expect(calls).toEqual(expectedCalls);
    act(() => renderer.unmount());
  });

  it("runs each normal action once in order and stops after a failure", async () => {
    const calls: string[] = [];
    const unregisterOne = registerEditorNodeAction("session", "one", async () => {
      calls.push("one");
      return { nodeId: "one", status: "success", output: { fresh: true } };
    });
    const unregisterTwo = registerEditorNodeAction("session", "two", async () => {
      calls.push("two");
      return { nodeId: "two", status: "failed", error: { message: "stopped here" } };
    });
    const unregisterThree = registerEditorNodeAction("session", "three", async () => {
      calls.push("three");
      return { nodeId: "three", status: "success" };
    });
    const nodes = [node("one"), node("two"), node("three")];
    const edges: Edge[] = [
      { id: "a", source: "one", target: "two" },
      { id: "b", source: "two", target: "three" },
    ];
    let execute!: (clusterId: string) => Promise<void>;
    let state!: (clusterId: string) => ClusterRunState;
    function Harness() {
      const hook = useClusterExecution({
        workflowSessionId: "session",
        nodes,
        edges,
        clusters: [{ id: clusterId, title: "Folder", memberNodeIds: ["one", "two", "three"] }],
      });
      execute = hook.executeCluster;
      state = hook.getState;
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(React.createElement(Harness)); });
    await act(async () => execute(clusterId));
    expect(calls).toEqual(["one", "two"]);
    expect(state(clusterId)).toMatchObject({ phase: "failed", currentNodeId: "two", completed: 1 });
    act(() => renderer.unmount());
    unregisterOne(); unregisterTwo(); unregisterThree();
  });
});
