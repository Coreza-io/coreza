import { z } from "zod";

export const createWorkflowSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  nodes: z.array(z.any()).min(1, "At least one node is required"),
  edges: z.array(z.any()),
  project_id: z.string().uuid().optional(),
  schedule_cron: z.string().optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nodes: z.array(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

export const scheduleWorkflowSchema = z.object({
  is_active: z.boolean(),
  executionId: z.string().uuid().optional(),
});

export const executeWorkflowSchema = z.object({
  input_data: z.record(z.unknown()).optional().default({}),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
