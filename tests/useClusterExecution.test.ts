import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Edge, Node } from "@xyflow/react";
import {
  buildClusterExecutionPlan,
  useClusterExecution,
  type ClusterRunState,
} from "@/hooks/useClusterExecution";
import { getEditorExecutionTarget, registerEditorNodeAction } from "@/services/editorNodeExecution";

const node = (id: string, values: Record<string, unknown> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: { name: id, node_type: "action", manualExecution: "available" }, values, workflowSessionId: "session" },
});

describe("manual cluster execution", () => {
  const clusterId = "00000000-0000-4000-8000-000000000001";
  it("defers ambiguous helper aliases to evaluated action subtrees", () => {
    const edit = node("edit", { fields: [{fieldName:"flag",dataType:"boolean",valueMode:"expression",value:'{{ false && lastN($("same").json.items, 1) }}'}] });
    edit.data.definition = { name:"Edit Fields",node_type:"action",manualExecution:"available" };
    const a = node("a"), b = node("b");
    a.data.displayName = "same"; b.data.displayName = "same";
    expect(buildClusterExecutionPlan({id:clusterId,title:"Folder",memberNodeIds:["edit"]},[edit,a,b],[]).executableNodeIds).toEqual(["edit"]);
  });
  it("clears active visuals on Stop while retaining ownership until settlement", async () => {
    let settle!: () => void;
    const unregister = registerEditorNodeAction("visual-stop", "one", async () => {
      await new Promise<void>((resolve) => { settle = resolve; });
      return { nodeId: "one", status: "success" };
    });
    let hook!: ReturnType<typeof useClusterExecution>;
    function Harness() {
      hook = useClusterExecution({ workflowSessionId: "visual-stop", nodes: [node("one"), node("two")],
        edges: [], clusters: [{ id: clusterId, title: "Folder", memberNodeIds: ["one", "two"] }] });
      return null;
    }
    // Both actions must be captured before the run starts.
    const unregisterTwo = registerEditorNodeAction("visual-stop", "two", async () => ({ nodeId: "two", status: "success" }));
    let renderer!: ReactTestRenderer;
    let run!: Promise<void>;
    act(() => { renderer = create(React.createElement(Harness)); });
    act(() => { run = hook.executeCluster(clusterId); });
    expect(hook.activeMember).toEqual({ sessionId: "visual-stop", clusterId, nodeId: "one" });
    act(() => hook.cancelRun(clusterId));
    expect(hook.activeMember).toBeNull();
    expect(hook.getState(clusterId).phase).toBe("running");
    expect(getEditorExecutionTarget("visual-stop")).toBe(`cluster:${clusterId}`);
    await act(async () => { settle(); await run; });
    expect(hook.activeMember).toBeNull();
    expect(hook.getState(clusterId).phase).toBe("cancelled");
    expect(getEditorExecutionTarget("visual-stop")).toBe("");
    act(() => renderer.unmount());
    unregister(); unregisterTwo();
  });
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
    ["loop", ["loop", "body", "loop", "body", "loop", "body", "loop", "done"]],
    ["done", ["loop", "done"]],
  ])("executes only the %s continuation of a manual Loop step", async (continuation, expectedCalls) => {
    const calls: string[] = [];
    let iterations = 0;
    registerEditorNodeAction("session", "loop", async () => {
      calls.push("loop");
      return { nodeId: "loop", status: "success", selectedContinuation: continuation === "loop" && iterations++ < 3 ? "loop" : "done" };
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

describe('complete Loop runs', () => {
  const clusterId = '123e4567-e89b-42d3-a456-426614174000';
  it.each(['success', 'pinned', 'failure', 'cancel', 'cap', 'session'] as const)('handles %s during iteration', async (mode) => {
    const loop = node('loop', { inputArray: [1, 2, 3] });
    loop.data.definition = { name: 'Loop', node_type: 'action', manualExecution: 'available', handles: [{ id: 'loop', type: 'source', connectionKind: 'main' }, { id: 'done', type: 'source', connectionKind: 'main' }] };
    const branch = node('if');
    branch.data.definition = { name: 'If', node_type: 'action', manualExecution: 'available', handles: [{ id: 'true', type: 'source', connectionKind: 'main' }, { id: 'false', type: 'source', connectionKind: 'main' }] };
    const nodes = [node('upstream'), loop, branch, node('left'), node('right'), node('done'), node('after'), node('unwired')];
    const edges: Edge[] = [
      { id: 'up-loop', source: 'upstream', target: 'loop' },
      { id: 'loop-if', source: 'loop', sourceHandle: 'loop', target: 'if' },
      { id: 'if-left', source: 'if', sourceHandle: 'true', target: 'left' },
      { id: 'if-right', source: 'if', sourceHandle: 'false', target: 'right' },
      { id: 'left-loop', source: 'left', target: 'loop' },
      { id: 'right-loop', source: 'right', target: 'loop' },
      { id: 'loop-done', source: 'loop', sourceHandle: 'done', target: 'done' },
      { id: 'done-after', source: 'done', target: 'after' },
    ];
    let hook!: ReturnType<typeof useClusterExecution>;
    let renderer!: ReactTestRenderer;
    let session = `loop-${mode}`;
    const originalSession = session;
    const calls: string[] = [];
    const feedback: string[] = [];
    let iteration = 0;
    for (const n of nodes) registerEditorNodeAction(session, n.id, async () => {
      calls.push(n.id);
      if (n.id === 'loop') {
        if (iteration > 0) expect(feedback).toHaveLength(iteration);
        iteration++;
        return { nodeId: n.id, status: 'success', selectedContinuation: iteration <= 3 || mode === 'cap' ? 'loop' : 'done' };
      }
      if (n.id === 'if') return { nodeId: n.id, status: 'success', selectedContinuation: iteration === 2 ? 'false' : 'true' };
      if (n.id === 'right' && mode === 'failure') return { nodeId: n.id, status: 'failed', error: { message: 'body failed' } };
      if (n.id === 'right' && mode === 'cancel') hook.cancelRun(clusterId);
      if (n.id === 'right' && mode === 'session') {
        session = 'replacement';
        act(() => renderer.update(React.createElement(Harness)));
      }
      return { nodeId: n.id, status: mode === 'pinned' ? 'pinned' : 'success', output: `${n.id}-${iteration}` };
    });
    function Harness() {
      hook = useClusterExecution({ workflowSessionId: session, nodes, edges,
        clusters: [{ id: clusterId, title: 'Loop run', memberNodeIds: nodes.map(n => n.id) }],
        writeLoopFeedback: (_loop, edge, value) => feedback.push(`${edge}:${value}`),
      });
      return null;
    }
    act(() => { renderer = create(React.createElement(Harness)); });
    await act(async () => hook.executeCluster(clusterId));
    if (mode === 'success' || mode === 'pinned') {
      expect(calls).toEqual(['upstream', 'unwired', 'loop', 'if', 'left', 'loop', 'if', 'right', 'loop', 'if', 'left', 'loop', 'done', 'after']);
      expect(feedback).toEqual(['left-loop:left-1', 'right-loop:right-2', 'left-loop:left-3']);
      expect(hook.getState(clusterId)).toMatchObject({ phase: 'completed', completed: 8, eligible: 8 });
    } else if (mode === 'session') {
      expect(hook.getState(clusterId).phase).toBe('idle');
      expect(calls.filter(id => id === 'loop')).toHaveLength(2);
    } else {
      expect(hook.getState(clusterId).phase).toBe(mode === 'cancel' ? 'cancelled' : 'failed');
      expect(calls).not.toContain('done');
      expect(calls.filter(id => id === 'loop')).toHaveLength(mode === 'cap' ? 4 : 2);
      expect(hook.getState(clusterId).outcomes?.done.status).toBe(mode === 'cancel' ? 'cancelled' : 'dependency-blocked');
    }
    expect(getEditorExecutionTarget(originalSession)).toBe('');
    act(() => renderer.unmount());
  });
});

it.each([false, true])('executes sequential Loops or rejects overlap before execution (overlap=%s)', async (overlap) => {
  const nodes = [node('l1', { inputArray: [1, 2] }), node('b1'), node('l2', { inputArray: [1, 2] }), node('b2'), node('end')];
  for (const n of nodes.filter(n => n.id.startsWith('l'))) n.data.definition = { name: 'Loop', node_type: 'action', manualExecution: 'available', handles: [{ id: 'loop', type: 'source', connectionKind: 'main' }, { id: 'done', type: 'source', connectionKind: 'main' }] };
  const edges: Edge[] = [
    { id: 'l1-b1', source: 'l1', sourceHandle: 'loop', target: 'b1' },
    { id: 'b1-l1', source: 'b1', target: 'l1' },
    { id: 'l1-l2', source: 'l1', sourceHandle: 'done', target: 'l2' },
    { id: 'l2-b2', source: 'l2', sourceHandle: 'loop', target: overlap ? 'b1' : 'b2' },
    { id: 'b2-l2', source: overlap ? 'b1' : 'b2', target: 'l2' },
    { id: 'l2-end', source: 'l2', sourceHandle: 'done', target: 'end' },
  ];
  const session = `sequential-${overlap}`;
  const calls: string[] = [];
  const counts: Record<string, number> = {};
  for (const n of nodes) registerEditorNodeAction(session, n.id, async () => {
    calls.push(n.id);
    counts[n.id] = (counts[n.id] ?? 0) + 1;
    return { nodeId: n.id, status: 'success', selectedContinuation: n.id.startsWith('l') ? counts[n.id] <= 2 ? 'loop' : 'done' : undefined };
  });
  let hook!: ReturnType<typeof useClusterExecution>;
  const id = '123e4567-e89b-42d3-a456-426614174000';
  function Harness() {
    hook = useClusterExecution({ workflowSessionId: session, nodes, edges, clusters: [{ id, title: 'Sequential', memberNodeIds: nodes.map(n => n.id) }] });
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(Harness)); });
  await act(async () => hook.executeCluster(id));
  if (overlap) {
    expect(calls).toEqual([]);
    expect(hook.getState(id)).toMatchObject({ phase: 'failed' });
  } else {
    expect(calls).toEqual(['l1', 'b1', 'l1', 'b1', 'l1', 'l2', 'b2', 'l2', 'b2', 'l2', 'end']);
    expect(hook.getState(id).phase).toBe('completed');
  }
  act(() => renderer.unmount());
});

it("executes a parent once under one lock and derives child progress without starting child runs", async () => {
  const outerId = "11111111-1111-4111-8111-111111111111";
  const innerId = "22222222-2222-4222-8222-222222222222";
  const calls: string[] = [];
  let settle!: () => void;
  const unregister = ["a", "b", "c"].map((id) =>
    registerEditorNodeAction("nested-run", id, async () => {
      calls.push(id);
      if (id === "a")
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
      return { nodeId: id, status: "success" };
    }),
  );
  let hook!: ReturnType<typeof useClusterExecution>;
  function Harness() {
    hook = useClusterExecution({
      workflowSessionId: "nested-run",
      nodes: ["a", "b", "c"].map((id) => node(id)),
      edges: [
        { id: "ab", source: "a", target: "b" },
        { id: "bc", source: "b", target: "c" },
      ],
      clusters: [
        { id: outerId, title: "Outer", memberNodeIds: ["c"] },
        {
          id: innerId,
          title: "Inner",
          memberNodeIds: ["a", "b"],
          parentClusterId: outerId,
        },
      ],
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  let run!: Promise<void>;
  act(() => {
    renderer = create(React.createElement(Harness));
  });
  act(() => {
    run = hook.executeCluster(outerId);
  });
  expect(getEditorExecutionTarget("nested-run")).toBe(`cluster:${outerId}`);
  expect(hook.getState(innerId)).toMatchObject({
    phase: "blocked",
    ownerClusterId: outerId,
    currentNodeId: "a",
    completed: 0,
    eligible: 2,
  });
  await act(async () => {
    await hook.executeCluster(innerId);
  });
  expect(calls).toEqual(["a"]);
  await act(async () => {
    settle();
    await run;
  });
  expect(calls).toEqual(["a", "b", "c"]);
  expect(hook.getState(outerId)).toMatchObject({
    phase: "completed",
    completed: 3,
    eligible: 3,
  });
  expect(hook.getState(innerId)).toMatchObject({
    phase: "completed",
    completed: 2,
    eligible: 2,
  });
  expect(getEditorExecutionTarget("nested-run")).toBe("");
  act(() => renderer.unmount());
  unregister.forEach((remove) => remove());
});

test("typed lastN dependencies order both operands and ignore fixed/quoted selector text", () => {
  const edit = node("edit", { fields: [
    { fieldName: "tail", valueMode: "expression", dataType: "array", value: '{{ lastN($("history").json.items, $("count").json.value) }}' },
    { fieldName: "fixed", valueMode: "fixed", dataType: "string", value: '{{ $("edit").json }}' },
    { fieldName: "quoted", valueMode: "expression", dataType: "string", value: `{{ "$('edit').json" }}` },
  ] });
  edit.data.definition = { name: "Edit Fields", node_type: "action", manualExecution: "available" };
  const cluster = { id: "00000000-0000-4000-8000-000000000001", title: "Folder", memberNodeIds: ["edit", "count", "history"] };
  expect(buildClusterExecutionPlan(cluster, [edit, node("count"), node("history")], []).executableNodeIds).toEqual(["count", "history", "edit"]);
});
