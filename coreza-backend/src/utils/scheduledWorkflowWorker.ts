/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type Redis from "ioredis";
import { Job, Queue, Worker } from "bullmq";
import { supabase } from "../config/supabase";
import { createSuccessOutput, createErrorOutput } from "./normalizeOutput";

export interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
}

interface ScheduledWorkerDependencies {
  redis: Redis;
  workflowQueue: Queue;
  workflowJobAttempts: number;
}

export function createScheduledWorkflowWorker({
  redis,
  workflowQueue,
  workflowJobAttempts,
}: ScheduledWorkerDependencies): Worker<ScheduledWorkflowJobData> {
  return new Worker(
    "scheduled-workflows",
    async (job: Job<ScheduledWorkflowJobData>) => {
      const { workflowId, userId } = job.data;
      const scheduledTimestamp = job.timestamp ?? Date.now();

      console.log(
        `⏰ Processing scheduled workflow ${workflowId} (jobId=${
          job.id
        }, fireTime=${new Date(scheduledTimestamp).toISOString()})`,
      );

      try {
        // Get workflow details
        const { data: workflow, error } = await supabase
          .from("workflows")
          .select("*")
          .eq("id", workflowId)
          .eq("is_active", true)
          .single();

        if (error || !workflow) {
          console.error(`Workflow ${workflowId} not found or not active`);
          return;
        }

        // Create workflow run with snapshot of current workflow state
        const { data: run, error: runError } = await supabase
          .from("workflow_runs")
          .insert({
            workflow_id: workflowId,
            status: "queued",
            initiated_by: userId,
            schedule_key: job.id,
            nodes: (workflow as any).nodes,
            edges: (workflow as any).edges,
            node_count: Array.isArray((workflow as any).nodes)
              ? (workflow as any).nodes.length
              : 0,
            edge_count: Array.isArray((workflow as any).edges)
              ? (workflow as any).edges.length
              : 0,
          } as any)
          .select()
          .single();

        if (runError) {
          if ((runError as any).code === "23505") {
            console.warn(
              `⚠️ Duplicate scheduled run prevented for workflow ${workflowId} (schedule_key=${job.id})`,
            );
            return createSuccessOutput(
              { skipped: true, schedule_key: job.id },
              { nodeName: "scheduler", category: "scheduled" },
            );
          }
          throw new Error(`Failed to create workflow run: ${runError.message}`);
        }

        const runId = (run as any).id;
        const jobId = `${userId}:${workflowId}:${runId}`;
        const data = {
          runId: (run as any).id,
          workflowId,
          userId,
          nodes: (workflow as any).nodes,
          edges: (workflow as any).edges,
          trigger: "scheduled",
          executionMode: "manual" as const,
        };

        workflowQueue.add("execute-workflow", data, {
          jobId,
          removeOnComplete: 50,
          removeOnFail: 100,
          attempts: workflowJobAttempts,
          backoff:
            workflowJobAttempts > 1
              ? {
                  type: "exponential",
                  delay: 2000,
                }
              : undefined,
        });

        console.log(
          `✅ Scheduled workflow run created for ${workflowId} (runId=${runId}, schedule_key=${job.id})`,
        );
        return createSuccessOutput(
          { runId, scheduleKey: job.id },
          { nodeName: "scheduler", category: "scheduled" },
        );
      } catch (error) {
        const errorOutput = createErrorOutput(error, {
          nodeName: "scheduler",
          category: "scheduled",
        });
        console.error(
          `❌ Scheduled workflow failed for ${workflowId}:`,
          errorOutput.error,
        );
        throw new Error(errorOutput.error);
      }
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );
}
