/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
        }, fireTime=${new Date(scheduledTimestamp).toISOString()})`
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
            nodes: workflow.nodes,
            edges: workflow.edges,
            node_count: Array.isArray(workflow.nodes)
              ? workflow.nodes.length
              : 0,
            edge_count: Array.isArray(workflow.edges)
              ? workflow.edges.length
              : 0,
          })
          .select()
          .single();

        if (runError) {
          if ((runError as any).code === "23505") {
            console.warn(
              `⚠️ Duplicate scheduled run prevented for workflow ${workflowId} (schedule_key=${job.id})`
            );
            return createSuccessOutput(
              { skipped: true, schedule_key: job.id },
              { nodeName: "scheduler", category: "scheduled" }
            );
          }
          throw new Error(`Failed to create workflow run: ${runError.message}`);
        }
        const jobId = `${userId}:${workflowId}:${run.id}`;
        const data = {
          runId: run.id,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
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
          `✅ Scheduled workflow run created for ${workflowId} (runId=${run.id}, schedule_key=${job.id})`
        );
        return createSuccessOutput(
          { runId: run.id, scheduleKey: job.id },
          { nodeName: "scheduler", category: "scheduled" }
        );
      } catch (error) {
        const errorOutput = createErrorOutput(error, {
          nodeName: "scheduler",
          category: "scheduled",
        });
        console.error(
          `❌ Scheduled workflow failed for ${workflowId}:`,
          errorOutput.error
        );
        throw new Error(errorOutput.error);
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );
}
