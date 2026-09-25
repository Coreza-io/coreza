import { compileClusterExecutionPlan, ClusterPreflightError } from "./clusterExecution";
import type { WorkflowNode, WorkflowEdge } from "../nodes/types";

const clusterId = "11111111-1111-4111-8111-111111111111";
const nodes: WorkflowNode[] = [
  { id: "external-in", name: "Source", node_type: "main", category: "IO" },
  { id: "a", name: "Action", node_type: "main", category: "Utility" },
  { id: "b", name: "Action", node_type: "main", category: "Utility" },
  { id: "tool", name: "Tool", node_type: "sub", category: "Tool" },
  { id: "external-out", name: "Sink", node_type: "main", category: "IO" },
];
const edges: WorkflowEdge[] = [
  { id: "input", source: "external-in", target: "a" },
  { id: "chain", source: "a", target: "b" },
  { id: "attachment", source: "tool", target: "b" },
  { id: "output", source: "b", target: "external-out" },
];
const workflow = {
  id: "22222222-2222-4222-8222-222222222222",
  revision: 7,
  nodes,
  edges,
  node_clusters: [{ id: clusterId, title: "Trade", memberNodeIds: ["tool", "b", "a"] }],
};

describe("compileClusterExecutionPlan", () => {
  it("derives a deterministic canonical scope and preserves boundary provenance", () => {
    const request = { workflow, clusterId, boundaryInputs: { input: { value: false } } };
    const first = compileClusterExecutionPlan(request);
    const second = compileClusterExecutionPlan(request);

    expect(first.planHash).toBe(second.planHash);
    expect(first.memberNodeIds).toEqual(["a", "b", "tool"]);
    expect(first.executableNodeIds).toEqual(["a", "b"]);
    expect(first.attachmentNodeIds).toEqual(["tool"]);
    expect(first.internalMainEdges.map(({ id }) => id)).toEqual(["chain"]);
    expect(first.internalAttachmentEdges.map(({ id }) => id)).toEqual(["attachment"]);
    expect(first.boundaryOutputEdges.map(({ id }) => id)).toEqual(["output"]);
    expect(first.entryActivations).toEqual([{ nodeId: "a", inputs: [{
      edgeId: "input", sourceNodeId: "external-in", value: false, provenance: "explicit",
    }] }]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entryActivations[0].inputs)).toBe(true);
    expect(Object.isFrozen(workflow.edges[0])).toBe(false);
  });

  it("rejects unsupported internal cycles", () => {
    const cyclic = {
      ...workflow,
      edges: [
        { id: "a-b", source: "a", target: "b" },
        { id: "b-a", source: "b", target: "a" },
        { id: "attachment", source: "tool", target: "b" },
      ],
    };
    expect(() => compileClusterExecutionPlan({ workflow: cyclic, clusterId })).toThrow(
      expect.objectContaining<Partial<ClusterPreflightError>>({ code: "unsupported_cycle" }),
    );
  });

  it("rejects missing boundary inputs before queueing", () => {
    expect(() => compileClusterExecutionPlan({ workflow, clusterId })).toThrow(
      expect.objectContaining<Partial<ClusterPreflightError>>({ code: "missing_boundary_input" }),
    );
  });

  it("rejects client input for an edge outside the boundary", () => {
    expect(() => compileClusterExecutionPlan({
      workflow,
      clusterId,
      boundaryInputs: { input: { value: 1 }, chain: { value: 2 } },
    })).toThrow(expect.objectContaining<Partial<ClusterPreflightError>>({ code: "missing_boundary_input" }));
  });

  it.each([
    [false],
    [0],
    [""],
    [[]],
    [{ data: null }],
  ])("preserves canonical pinned output %#", (pinnedOutput) => {
    const pinnedWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === "a" ? { ...node, pinnedOutput } : node),
    };
    const plan = compileClusterExecutionPlan({
      workflow: pinnedWorkflow,
      clusterId,
      boundaryInputs: { input: { value: true } },
    });
    expect(plan.pinnedResults.a).toEqual({ success: true, status: "pinned", data: pinnedOutput });
  });

  it("includes boundary values, references, and pins in the plan hash", () => {
    const pinnedWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === "a" ? { ...node, pinnedOutput: 0 } : node),
    };
    const first = compileClusterExecutionPlan({
      workflow: pinnedWorkflow,
      clusterId,
      boundaryInputs: { input: { value: 1 } },
      referenceSnapshots: { outside: { value: 1 } },
    });
    const second = compileClusterExecutionPlan({
      workflow: pinnedWorkflow,
      clusterId,
      boundaryInputs: { input: { value: 2 } },
      referenceSnapshots: { outside: { value: 1 } },
    });
    expect(first.planHash).not.toBe(second.planHash);
  });

  it("rejects parallel loops until descendant completion is supported", () => {
    const parallelWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === "a"
        ? { ...node, name: "Loop", values: { parallel: true } }
        : node),
    };
    expect(() => compileClusterExecutionPlan({
      workflow: parallelWorkflow,
      clusterId,
      boundaryInputs: { input: { value: [1, 2] } },
    })).toThrow(expect.objectContaining<Partial<ClusterPreflightError>>({ code: "unsupported_execution_context" }));
  });
});
