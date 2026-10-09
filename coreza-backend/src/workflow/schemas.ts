import { z } from "zod";

const nodeClusterSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  note: z.string().max(200).optional(),
  memberNodeIds: z.array(z.string().min(1)),
  parentClusterId: z.string().min(1).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  nodes: z.array(z.any()).min(1, "At least one node is required"),
  edges: z.array(z.any()),
  project_id: z.string().uuid().nullable().optional(),
  schedule_cron: z.string().optional(),
  cluster_format_version: z.literal(2).optional(),
  node_clusters: z.array(nodeClusterSchema).optional().default([]),
});

export const updateWorkflowSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  name: z.string().min(1).max(200).optional(),
  nodes: z.array(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  project_id: z.string().uuid().nullable().optional(),
  cluster_format_version: z.literal(2).optional(),
  node_clusters: z.array(nodeClusterSchema).optional(),
});

export const scheduleWorkflowSchema = z.object({
  is_active: z.boolean(),
  executionId: z.string().uuid().optional(),
});

export const executeWorkflowSchema = z.object({
  input_data: z.record(z.unknown()).optional().default({}),
  expected_revision: z.number().int().nonnegative(),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("workflow") }),
    z.object({ kind: z.literal("cluster"), clusterId: z.string().uuid() }),
  ]).optional().default({ kind: "workflow" }),
  idempotency_key: z.string().uuid().optional(),
  boundary_inputs: z.record(z.unknown()).optional(),
  reference_snapshots: z.record(z.unknown()).optional(),
}).strict();

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
