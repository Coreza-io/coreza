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

import * as schedule from "node-schedule";
import { supabase } from "../../config/supabase";
import { formatInTimeZone } from "date-fns-tz";
import { bullMqJobQueue as jobQueue } from "../jobQueueManager";
import { ISchedulerService, ScheduleInfo, ScheduleOptions } from "./types";

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
};

interface ScheduledJob {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
  job: schedule.Job;
}

/**
 * In-Process Scheduler using node-schedule
 * 
 * Characteristics:
 * - Simple setup, no external dependencies beyond Redis (for job queue)
 * - In-memory timers - lost on restart
 * - Single-instance only - duplicates possible with multiple instances
 * - Good for development and single-server deployments
 */
export class InProcessScheduler implements ISchedulerService {
  readonly type = 'in-process' as const;
  private scheduledJobs: Map<string, ScheduledJob> = new Map();

  async initialize(): Promise<void> {
    console.log("🕐 [IN-PROCESS SCHEDULER] Initializing workflow scheduler...");

    try {
      const { data: workflows, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("is_active", true)
        .not("schedule_cron", "is", null);

      if (error) {
        console.error("❌ [IN-PROCESS SCHEDULER] Failed to load scheduled workflows:", error);
        return;
      }

      console.log(`📅 [IN-PROCESS SCHEDULER] Found ${workflows.length} scheduled workflows to initialize`);

      let successCount = 0;
      for (const workflow of workflows) {
        try {
          await this.scheduleWorkflow(
            workflow.id,
            workflow.user_id,
            workflow.schedule_cron,
            workflow.nodes,
            workflow.edges
          );
          successCount++;
        } catch (error) {
          const normalized = normalizeError(error);
          console.error(`❌ [IN-PROCESS SCHEDULER] Failed to schedule workflow ${workflow.id}:`, normalized);
        }
      }

      console.log(`✅ [IN-PROCESS SCHEDULER] Initialized: ${successCount}/${workflows.length} workflows scheduled`);
    } catch (error) {
      const normalized = normalizeError(error);
      console.error("💥 [IN-PROCESS SCHEDULER] Critical error during initialization:", normalized);
    }
  }

  private formatTime(date: Date, timezone?: string): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "Invalid Date";
    if (!timezone) return date.toISOString();

    try {
      const local = formatInTimeZone(date, timezone, "yyyy-MM-dd HH:mm:ss XXX");
      return `${local} (${timezone})`;
    } catch (error) {
      console.error(`⚠️ [IN-PROCESS SCHEDULER] Invalid timezone ${timezone}, falling back to UTC`);
      return date.toISOString();
    }
  }

  private getFireDate(next: any): Date | undefined {
    if (!next) return undefined;
    if (next instanceof Date) return next;
    if (next.fireDate instanceof Date) return next.fireDate;
    if (typeof next.getTime === "function") {
      const t = next.getTime();
      if (typeof t === "number" && !Number.isNaN(t)) return new Date(t);
    }
    if (typeof next.toDate === "function") {
      const d = next.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    }
    return undefined;
  }

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string,
    nodes: any[],
    edges: any[],
    options: ScheduleOptions = {}
  ): Promise<void> {
    await this.unscheduleWorkflow(workflowId);

    try {
      const timezone = options.timezone;
      let normalizedStart: Date | undefined;
      if (options.start) {
        const candidate = typeof options.start === "string"
          ? new Date(options.start)
          : options.start;
        normalizedStart = Number.isNaN(candidate.getTime()) ? undefined : candidate;
      }
      const startInfo = normalizedStart?.toISOString() || "immediate";

      console.log(`📅 [IN-PROCESS SCHEDULER] Creating schedule for workflow ${workflowId} with cron: ${cronExpression} (start: ${startInfo})`);

      const jobConfig = normalizedStart
        ? { start: normalizedStart, rule: cronExpression }
        : cronExpression;

      const job = schedule.scheduleJob(jobConfig, async () => {
        const executionId = `${workflowId}_${Date.now()}`;
        console.log(`🚀 [IN-PROCESS SCHEDULER] Starting scheduled execution ${executionId} for workflow ${workflowId}`);

        let runId = null;
        const startTime = Date.now();

        try {
          const { data: run, error: runError } = await supabase
            .from("workflow_runs")
            .insert({
              workflow_id: workflowId,
              status: "queued",
              initiated_by: userId,
              nodes: nodes,
              edges: edges,
              node_count: Array.isArray(nodes) ? nodes.length : 0,
              edge_count: Array.isArray(edges) ? edges.length : 0,
            })
            .select()
            .single();

          if (runError) {
            console.error(`❌ [IN-PROCESS SCHEDULER] Failed to create run for workflow ${workflowId}:`, runError);
            return;
          }

          runId = run.id;
          console.log(`✅ [IN-PROCESS SCHEDULER] Created workflow run ${runId} for scheduled execution ${executionId}`);

          await jobQueue.addWorkflowExecution({
            runId: run.id,
            workflowId,
            userId,
            nodes,
            edges,
            trigger: "scheduled",
          });
        } catch (error) {
          const normalized = normalizeError(error);
          const executionTime = Date.now() - startTime;
          console.error(`💥 [IN-PROCESS SCHEDULER] Critical error in execution ${executionId} after ${executionTime}ms:`, normalized);

          if (runId) {
            try {
              await supabase
                .from("workflow_runs")
                .update({
                  status: "failed",
                  completed_at: new Date().toISOString(),
                  error_message: normalized.message || "Unknown scheduler error",
                })
                .eq("id", runId);
            } catch (updateError) {
              console.error(`❌ [IN-PROCESS SCHEDULER] Failed to update failed run ${runId}:`, updateError);
            }
          }
        }
      });

      if (!job) {
        throw new Error(`Failed to create schedule for workflow ${workflowId}`);
      }

      this.scheduledJobs.set(workflowId, {
        workflowId,
        userId,
        cronExpression,
        timezone,
        job,
      });

      const nextRunRaw = job.nextInvocation();
      const nextRunDate = this.getFireDate(nextRunRaw);
      console.log(`✅ [IN-PROCESS SCHEDULER] Successfully scheduled workflow ${workflowId} - Next execution: ${nextRunDate}`);
    } catch (error) {
      const normalized = normalizeError(error);
      console.error(`❌ [IN-PROCESS SCHEDULER] Failed to schedule workflow ${workflowId}:`, normalized);
      throw normalized;
    }
  }

  async unscheduleWorkflow(workflowId: string): Promise<void> {
    const scheduledJob = this.scheduledJobs.get(workflowId);

    if (scheduledJob) {
      scheduledJob.job.cancel();
      this.scheduledJobs.delete(workflowId);
      const tzInfo = scheduledJob.timezone ? ` in ${scheduledJob.timezone}` : "";
      console.log(`🗑️ [IN-PROCESS SCHEDULER] Unscheduled workflow: ${workflowId} (was scheduled with: ${scheduledJob.cronExpression}${tzInfo})`);
    } else {
      console.log(`ℹ️ [IN-PROCESS SCHEDULER] No scheduled job found for workflow: ${workflowId}`);
    }
  }

  async updateWorkflowSchedule(
    workflowId: string,
    userId: string,
    cronExpression: string | null,
    nodes: any[],
    edges: any[],
    timezone?: string
  ): Promise<void> {
    const tzInfo = timezone ? ` (${timezone})` : "";
    console.log(`🔄 [IN-PROCESS SCHEDULER] Updating schedule for workflow ${workflowId} - New cron: ${cronExpression || "UNSCHEDULED"}${tzInfo}`);

    if (cronExpression) {
      await this.scheduleWorkflow(workflowId, userId, cronExpression, nodes, edges, { timezone });
      console.log(`✅ [IN-PROCESS SCHEDULER] Schedule updated for workflow ${workflowId}`);
    } else {
      await this.unscheduleWorkflow(workflowId);
      console.log(`✅ [IN-PROCESS SCHEDULER] Workflow ${workflowId} unscheduled successfully`);
    }
  }

  getScheduledJobs(): ScheduleInfo[] {
    const jobs: ScheduleInfo[] = [];
    for (const [workflowId, scheduledJob] of this.scheduledJobs.entries()) {
      const nextRunRaw = scheduledJob.job.nextInvocation();
      jobs.push({
        workflowId,
        userId: scheduledJob.userId,
        cronExpression: scheduledJob.cronExpression,
        timezone: scheduledJob.timezone,
        nextRun: this.getFireDate(nextRunRaw),
      });
    }
    console.log(`📊 [IN-PROCESS SCHEDULER] Currently managing ${jobs.length} scheduled workflows`);
    return jobs;
  }

  getNextRunDate(workflowId: string): Date | undefined {
    const scheduledJob = this.scheduledJobs.get(workflowId);
    if (!scheduledJob) return undefined;
    return this.getFireDate(scheduledJob.job.nextInvocation());
  }

  async shutdown(): Promise<void> {
    const jobCount = this.scheduledJobs.size;
    console.log(`🛑 [IN-PROCESS SCHEDULER] Shutting down - Cancelling ${jobCount} jobs...`);

    for (const [workflowId, scheduledJob] of this.scheduledJobs.entries()) {
      try {
        scheduledJob.job.cancel();
        console.log(`✅ [IN-PROCESS SCHEDULER] Cancelled job for workflow ${workflowId}`);
      } catch (error) {
        console.error(`❌ [IN-PROCESS SCHEDULER] Failed to cancel job for workflow ${workflowId}:`, error);
      }
    }

    this.scheduledJobs.clear();
    console.log(`✅ [IN-PROCESS SCHEDULER] Shutdown complete - All ${jobCount} jobs cancelled`);
  }
}
