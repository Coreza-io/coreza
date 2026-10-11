import { validateNodeClusterDocument } from "./validateNodeClusters";
import { compileClusterExecutionPlan } from "./clusterExecution";
import { createWorkflowSchema, updateWorkflowSchema } from "./schemas";
import { WorkflowQueryService } from "./WorkflowQueryService";
const outer = "11111111-1111-4111-8111-111111111111";
const inner = "22222222-2222-4222-8222-222222222222";
const nodes = ["a", "b"].map((id) => ({
  id,
  name: "Action",
  node_type: "main",
  category: "Utility",
}));
const clusters = [
  {
    id: inner,
    title: "Inner",
    memberNodeIds: ["a", "b"],
    parentClusterId: outer,
  },
  { id: outer, title: "Outer", memberNodeIds: [] },
];
const workflow = {
  id: "workflow",
  revision: 1,
  name: "Workflow",
  nodes,
  edges: [{ id: "ab", source: "a", target: "b" }],
  node_clusters: clusters,
  project_id: null,
};
it("retains an unordered child-only parent in validation, schemas and execution snapshots", () => {
  expect(validateNodeClusterDocument(workflow)).toEqual(clusters);
  expect(
    createWorkflowSchema.parse({ ...workflow, cluster_format_version: 2 })
      .node_clusters,
  ).toEqual(clusters);
  const plan = compileClusterExecutionPlan({ workflow, clusterId: outer });
  expect(plan.memberNodeIds).toEqual(["a", "b"]);
  expect(plan.executableNodeIds).toEqual(["a", "b"]);
  const reordered = compileClusterExecutionPlan({
    workflow: { ...workflow, node_clusters: [...clusters].reverse() },
    clusterId: outer,
  });
  expect(plan.planHash).toBe(reordered.planHash);
  const changed = compileClusterExecutionPlan({
    workflow: {
      ...workflow,
      node_clusters: [{ ...clusters[0], parentClusterId: undefined }],
    },
    clusterId: inner,
  });
  expect(changed.planHash).not.toBe(
    compileClusterExecutionPlan({ workflow, clusterId: inner }).planHash,
  );
});
it.each([null, "", 2])(
  "rejects invalid parent %p at the request boundary",
  (parentClusterId) => {
    expect(() =>
      updateWorkflowSchema.parse({
        expected_revision: 1,
        node_clusters: [{ ...clusters[0], parentClusterId }],
      }),
    ).toThrow();
  },
);
function service(ready = true, existing = workflow) {
  const repo = {
    getOwnedWorkflow: jest.fn().mockResolvedValue(existing),
    hierarchyReady: jest.fn().mockResolvedValue(ready),
    update: jest.fn().mockImplementation((_user, _id, input) => input),
    create: jest.fn().mockImplementation((_user, input) => input),
  };
  return {
    repo,
    query: new WorkflowQueryService(repo as any, {} as any, {} as any),
  };
}
it.each([
  [[]],
  [[{ id: outer, title: "Flattened", memberNodeIds: ["a", "b"] }]],
])(
  "refuses unsupported replacement of existing hierarchy with %p",
  async (node_clusters) => {
    const { repo, query } = service();
    await expect(
      query.updateWorkflow("user", "workflow", {
        expected_revision: 1,
        node_clusters,
      }),
    ).rejects.toThrow("cluster-writer-upgrade-required");
    expect(repo.update).not.toHaveBeenCalled();
  },
);
it("requires deployed protection, preserves partial metadata, and permits intentional dissolution", async () => {
  const { query, repo } = service(false);
  expect(await query.getCapabilities()).toEqual({
    expression_format_version: 0,
    cluster_format_version: 1,
    max_cluster_depth: 1,
  });
  await expect(
    query.updateWorkflow("user", "workflow", {
      expected_revision: 1,
      node_clusters: [],
      cluster_format_version: 2,
    }),
  ).rejects.toThrow("cluster-hierarchy-unavailable");
  expect(repo.update).not.toHaveBeenCalled();
  const ready = service();
  const partial = await ready.query.updateWorkflow("user", "workflow", {
    expected_revision: 1,
    name: "Updated",
    cluster_format_version: 2,
  });
  expect(partial.node_clusters).toEqual(clusters);
  const dissolved = await ready.query.updateWorkflow("user", "workflow", {
    expected_revision: 1,
    node_clusters: [],
    cluster_format_version: 2,
  });
  expect(dissolved.node_clusters).toEqual([]);
  await expect(
    ready.query.updateWorkflow("user", "workflow", {
      expected_revision: 0,
      node_clusters: [],
      cluster_format_version: 2,
    }),
  ).rejects.toThrow("workflow-revision-conflict");
});
it("keeps old flat writers compatible", async () => {
  const { query } = service(false, { ...workflow, node_clusters: [] });
  expect(
    (
      await query.updateWorkflow("user", "workflow", {
        expected_revision: 1,
        node_clusters: [],
      })
    ).node_clusters,
  ).toEqual([]);
});

it("uses the legacy flat RPC argument shape even when the new client declares format two", async () => {
  const {query, repo} = service(false, {...workflow,node_clusters:[]});
  const result = await query.updateWorkflow("user", "workflow", {
    expected_revision:1, nodes, edges:workflow.edges, node_clusters:[], cluster_format_version:2,
  });
  expect(result.cluster_format_version).toBeUndefined();
  expect(repo.hierarchyReady).not.toHaveBeenCalled();
});

it("forwards a format-two declaration for intentional dissolution of an existing nested document", async () => {
  const {query} = service();
  expect((await query.updateWorkflow("user","workflow",{
    expected_revision:1, node_clusters:[], cluster_format_version:2,
  })).cluster_format_version).toBe(2);
});
