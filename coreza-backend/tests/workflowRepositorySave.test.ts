/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0 only.
 *
 * See the LICENSE file for details.
 */

const rpc = jest.fn();
const logError = jest.fn();

jest.mock("../src/config/supabase", () => ({
  supabase: { rpc },
}));

jest.mock("../src/utils/logger", () => ({
  createLogger: () => ({ error: logError }),
}));

import { WorkflowRepository } from "../src/workflow/WorkflowRepository";
import { WorkflowQueryService } from "../src/workflow/WorkflowQueryService";

const input = {
  expected_revision: 2,
  name: "Saved workflow",
  nodes: [{ id: "node-1" }],
  edges: [],
  node_clusters: [],
  project_id: null,
};

describe("WorkflowRepository.update", () => {
  beforeEach(() => {
    rpc.mockReset();
    logError.mockReset();
  });

  it.each([
    ["workflow-not-found", undefined, 404, "Workflow not found"],
    ["empty-workflow", undefined, 400, "A saved workflow cannot be empty"],
    ["workflow-revision-conflict", "40001", 409, "workflow-revision-conflict"],
    ["cluster-writer-upgrade-required", undefined, 409, "cluster-writer-upgrade-required"],
  ])("maps %s to an actionable response", async (message, code, statusCode, expectedMessage) => {
    rpc.mockResolvedValue({ data: null, error: { message, code } });

    await expect(new WorkflowRepository().update("user-1", "workflow-1", input))
      .rejects.toMatchObject({ statusCode, message: expectedMessage });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("keeps infrastructure diagnostics in server logs without exposing them to users", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.save_workflow_document",
        code: "PGRST202",
        details: "schema cache lookup failed",
      },
    });

    await expect(new WorkflowRepository().update("user-1", "workflow-1", input))
      .rejects.toMatchObject({
        statusCode: 500,
        message: "Failed to update workflow",
        code: "WORKFLOW_SAVE_FAILED",
        details: { databaseCode: "PGRST202" },
      });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PGRST202" }),
      "save_workflow_document failed",
    );
  });

  it("returns the saved workflow when the RPC succeeds", async () => {
    const saved = { id: "workflow-1", revision: 3 };
    rpc.mockResolvedValue({ data: saved, error: null });

    await expect(new WorkflowRepository().update("user-1", "workflow-1", input))
      .resolves.toEqual(saved);
  });
});

it('forwards hierarchy declarations to the atomic RPC without changing old flat calls',async()=> {
  rpc.mockReset(); rpc.mockResolvedValue({data:{id:'workflow-1'},error:null});
  const repo=new WorkflowRepository();
  await repo.update('user-1','workflow-1',{...input,cluster_format_version:2});
  expect(rpc).toHaveBeenLastCalledWith('save_workflow_document',expect.objectContaining({p_cluster_format_version:2}));
  await repo.update('user-1','workflow-1',input);
  expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_cluster_format_version');
});

it('fails closed when database readiness is absent or reports an error',async()=> {
  rpc.mockReset(); const repo=new WorkflowRepository();
  rpc.mockResolvedValueOnce({data:null,error:{message:'missing function'}});
  expect(await repo.hierarchyReady()).toBe(false);
  rpc.mockResolvedValueOnce({data:true,error:null});
  expect(await repo.hierarchyReady()).toBe(true);
});

it("saves flat documents against the pre-migration RPC even when the client declares format two", async () => {
  const flat={...input,revision:2};
  rpc.mockReset();
  rpc.mockImplementation(async (name,args) => name === "cluster_hierarchy_write_ready" || args?.p_cluster_format_version !== undefined
    ? {data:null,error:{code:"PGRST202",message:"Could not find the function in the schema cache"}}
    : {data:{...flat,revision:3},error:null});
  const repo=new WorkflowRepository();
  jest.spyOn(repo,"getOwnedWorkflow").mockResolvedValue(flat as any);
  const service=new WorkflowQueryService(repo,{} as any,{} as any);
  expect(await service.getCapabilities()).toEqual({cluster_format_version:1,max_cluster_depth:1});
  await expect(service.updateWorkflow("user","workflow",{...input,cluster_format_version:2})).resolves.toMatchObject({revision:3});
  expect(rpc).toHaveBeenLastCalledWith("save_workflow_document",expect.not.objectContaining({p_cluster_format_version:2}));
});
