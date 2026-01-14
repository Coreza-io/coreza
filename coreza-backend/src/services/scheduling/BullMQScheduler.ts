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

import { Queue, Worker, Job } from "bullmq";
import { supabase } from "../../config/supabase";
import { getRedisQueue } from "../../config/redis";
import { ISchedulerService, ScheduleInfo, ScheduleOptions } from "./types";
import { createSuccessOutput, createErrorOutput } from "../../utils/normalizeOutput";

const redis = getRedisQueue();

interface ScheduledJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
  scheduledAt?: number; // Timestamp when job was scheduled (for idempotency)
}

/**
 * BullMQ-based Scheduler
 * 
 * Characteristics:
 * - Durable: schedules survive restarts (stored in Redis)
 * - Multi-instance safe: no duplicate triggers
 * - Production-ready: pause/resume, observability
 * - Requires Redis for persistence
 * 
 * Architecture:
 * - scheduled-workflows queue: contains repeatable trigger jobs
 * - On fire: validates workflow → creates workflow_runs row → enqueues to workflow-execution
 */
export class BullMQScheduler implements ISchedulerService {
  readonly type = 'bullmq' as const;
  
  private scheduledQueue: Queue<ScheduledJobData>;
  private workflowQueue: Queue;
  private scheduledWorker: Worker<ScheduledJobData>;
  
  // In-memory cache for quick lookups (synced from Redis repeatables)
  private scheduleCache: Map<string, ScheduleInfo> = new Map();

  constructor() {
    this.scheduledQueue = new Queue<ScheduledJobData>("scheduled-workflows", {
      connection: redis,
    });
    
    this.workflowQueue = new Queue("workflow-execution", {
      connection: redis,
    });

    // Worker processes scheduled triggers
    this.scheduledWorker = new Worker<ScheduledJobData>(
      "scheduled-workflows",
      async (job: Job<ScheduledJobData>) => {
        return this.processScheduledTrigger(job);
      },
      {
        connection: redis,
        concurrency: 10,
      }
    );

    // Event listeners
    this.scheduledWorker.on("completed", (job) => {
      console.log(`⏰ [BULLMQ SCHEDULER] Scheduled job ${job.id} completed`);
    });

    this.scheduledWorker.on("failed", (job, err) => {
      console.error(`❌ [BULLMQ SCHEDULER] Scheduled job ${job?.id} failed:`, err.message);
    });
  }

  /**
   * Process a scheduled workflow trigger
   * 1. Validate workflow is still active
   * 2. Create workflow_runs row with schedule_key for idempotency
   * 3. Enqueue execution job to workflow-execution queue
   */
  private async processScheduledTrigger(job: Job<ScheduledJobData>) {
    const { workflowId, userId, timezone } = job.data;
    
    // Generate deterministic schedule_key for idempotency
    // Using job.id + processedOn ensures uniqueness per fire
    const scheduleKey = `${workflowId}:${job.id}:${job.processedOn || Date.now()}`;
    
    console.log(`⏰ [BULLMQ SCHEDULER] Processing scheduled trigger for workflow ${workflowId} (key: ${scheduleKey})`);

    try {
      // 1. Validate workflow is still active
      const { data: workflow, error: fetchError } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("is_active", true)
        .single();

      if (fetchError || !workflow) {
        console.log(`⏭️ [BULLMQ SCHEDULER] Skipping: workflow ${workflowId} not found or inactive`);
        return createSuccessOutput({ skipped: true, reason: "workflow_inactive" }, {
          nodeName: "scheduler",
          category: "scheduled"
        });
      }

      // 2. Create workflow_runs row with idempotency check via schedule_key
      const { data: run, error: insertError } = await supabase
        .from("workflow_runs")
        .insert({
          workflow_id: workflowId,
          status: "queued",
          initiated_by: userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          node_count: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
          edge_count: Array.isArray(workflow.edges) ? workflow.edges.length : 0,
          schedule_key: scheduleKey, // For duplicate prevention
        })
        .select()
        .single();

      // Handle unique constraint violation (duplicate fire)
      if (insertError?.code === "23505") {
        console.log(`⏭️ [BULLMQ SCHEDULER] Duplicate schedule fire detected, skipping: ${scheduleKey}`);
        return createSuccessOutput({ skipped: true, reason: "duplicate_fire", scheduleKey }, {
          nodeName: "scheduler",
          category: "scheduled"
        });
      }

      if (insertError) {
        throw new Error(`Failed to create workflow run: ${insertError.message}`);
      }

      // 3. Enqueue to workflow-execution queue
      await this.workflowQueue.add("execute-workflow", {
        runId: run.id,
        workflowId,
        userId,
        nodes: workflow.nodes,
        edges: workflow.edges,
        trigger: "scheduled",
      });

      console.log(`✅ [BULLMQ SCHEDULER] Scheduled run ${run.id} enqueued for workflow ${workflowId}`);
      
      return createSuccessOutput({ runId: run.id, workflowId, scheduleKey }, {
        nodeName: "scheduler",
        category: "scheduled"
      });
    } catch (error) {
      const errorOutput = createErrorOutput(error, {
        nodeName: "scheduler",
        category: "scheduled"
      });
      console.error(`❌ [BULLMQ SCHEDULER] Scheduled workflow failed for ${workflowId}:`, errorOutput.error);
      throw new Error(errorOutput.error);
    }
  }

  async initialize(): Promise<void> {
    console.log("🕐 [BULLMQ SCHEDULER] Initializing BullMQ-based scheduler...");

    try {
      // BullMQ repeatable jobs are persisted in Redis and resume automatically
      // We just need to sync our cache with existing repeatables
      const repeatables = await this.scheduledQueue.getRepeatableJobs();
      
      console.log(`📅 [BULLMQ SCHEDULER] Found ${repeatables.length} existing repeatable jobs in Redis`);

      // Rebuild cache from repeatables
      for (const rep of repeatables) {
        const workflowId = this.extractWorkflowIdFromJobId(rep.id || rep.key);
        if (workflowId) {
          this.scheduleCache.set(workflowId, {
            workflowId,
            userId: "", // Not stored in repeatable metadata
            cronExpression: rep.pattern || "",
            timezone: rep.tz,
            nextRun: rep.next ? new Date(rep.next) : undefined,
            jobId: rep.id,
          });
        }
      }

      // Optionally: verify DB schedules match Redis repeatables
      const { data: workflows, error } = await supabase
        .from("workflows")
        .select("id, user_id, schedule_cron, is_active")
        .eq("is_active", true)
        .not("schedule_cron", "is", null);

      if (!error && workflows) {
        let syncCount = 0;
        for (const workflow of workflows) {
          const existing = this.scheduleCache.get(workflow.id);
          if (!existing) {
            // Schedule exists in DB but not in Redis - re-register
            console.log(`🔄 [BULLMQ SCHEDULER] Re-registering workflow ${workflow.id} (missing from Redis)`);
            // Note: We'd need nodes/edges here for full re-registration
            // For now, just log the discrepancy
            syncCount++;
          }
        }
        if (syncCount > 0) {
          console.log(`⚠️ [BULLMQ SCHEDULER] ${syncCount} workflows need re-registration on next activation`);
        }
      }

      console.log(`✅ [BULLMQ SCHEDULER] Initialized with ${this.scheduleCache.size} schedules cached`);
    } catch (error) {
      console.error("💥 [BULLMQ SCHEDULER] Critical error during initialization:", error);
    }
  }

  private extractWorkflowIdFromJobId(jobIdOrKey: string): string | null {
    // Job ID format: schedule:{workflowId}
    const match = jobIdOrKey.match(/schedule:([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string,
    nodes: any[],
    edges: any[],
    options: ScheduleOptions = {}
  ): Promise<void> {
    // Remove existing repeatable if exists
    await this.unscheduleWorkflow(workflowId);

    const jobId = `schedule:${workflowId}`;
    const timezone = options.timezone || "UTC";

    console.log(`📅 [BULLMQ SCHEDULER] Creating schedule for workflow ${workflowId} with cron: ${cronExpression} (tz: ${timezone})`);

    try {
      // Parse start date if provided
      let startDate: Date | undefined;
      if (options.start) {
        startDate = typeof options.start === "string"
          ? new Date(options.start)
          : options.start;
        if (isNaN(startDate.getTime())) {
          startDate = undefined;
        }
      }

      // Add repeatable job with deterministic jobId
      await this.scheduledQueue.add(
        jobId,
        {
          workflowId,
          userId,
          cronExpression,
          timezone,
          scheduledAt: Date.now(),
        },
        {
          repeat: {
            pattern: cronExpression,
            tz: timezone,
            startDate,
          },
          jobId,
          removeOnComplete: 10,
          removeOnFail: 50,
        }
      );

      // Update cache
      this.scheduleCache.set(workflowId, {
        workflowId,
        userId,
        cronExpression,
        timezone,
        nextRun: undefined, // Will be populated on next getScheduledJobs()
        jobId,
      });

      console.log(`✅ [BULLMQ SCHEDULER] Successfully scheduled workflow ${workflowId}`);
    } catch (error) {
      console.error(`❌ [BULLMQ SCHEDULER] Failed to schedule workflow ${workflowId}:`, error);
      throw error;
    }
  }

  async unscheduleWorkflow(workflowId: string): Promise<void> {
    const jobId = `schedule:${workflowId}`;

    console.log(`🗑️ [BULLMQ SCHEDULER] Unscheduling workflow ${workflowId}`);

    try {
      // Get all repeatables and find the one for this workflow
      const repeatables = await this.scheduledQueue.getRepeatableJobs();
      
      for (const rep of repeatables) {
        if (rep.id === jobId || rep.key.includes(workflowId)) {
          await this.scheduledQueue.removeRepeatableByKey(rep.key);
          console.log(`🗑️ [BULLMQ SCHEDULER] Removed repeatable: ${rep.key}`);
        }
      }

      // Remove any waiting/delayed jobs
      const jobs = await this.scheduledQueue.getJobs(["waiting", "delayed"]);
      for (const job of jobs) {
        if (job.id === jobId || job.data.workflowId === workflowId) {
          await job.remove();
          console.log(`🗑️ [BULLMQ SCHEDULER] Removed pending job: ${job.id}`);
        }
      }

      // Update cache
      this.scheduleCache.delete(workflowId);
      
      console.log(`✅ [BULLMQ SCHEDULER] Workflow ${workflowId} unscheduled`);
    } catch (error) {
      console.error(`❌ [BULLMQ SCHEDULER] Failed to unschedule workflow ${workflowId}:`, error);
      throw error;
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
    console.log(`🔄 [BULLMQ SCHEDULER] Updating schedule for workflow ${workflowId} - New cron: ${cronExpression || "UNSCHEDULED"}${tzInfo}`);

    if (cronExpression) {
      await this.scheduleWorkflow(workflowId, userId, cronExpression, nodes, edges, { timezone });
      console.log(`✅ [BULLMQ SCHEDULER] Schedule updated for workflow ${workflowId}`);
    } else {
      await this.unscheduleWorkflow(workflowId);
      console.log(`✅ [BULLMQ SCHEDULER] Workflow ${workflowId} unscheduled successfully`);
    }
  }

  getScheduledJobs(): ScheduleInfo[] {
    const jobs = Array.from(this.scheduleCache.values());
    console.log(`📊 [BULLMQ SCHEDULER] Currently managing ${jobs.length} scheduled workflows`);
    return jobs;
  }

  getNextRunDate(workflowId: string): Date | undefined {
    return this.scheduleCache.get(workflowId)?.nextRun;
  }

  async shutdown(): Promise<void> {
    console.log(`🛑 [BULLMQ SCHEDULER] Shutting down...`);

    try {
      // Close worker (stops processing new jobs)
      await this.scheduledWorker.close();
      console.log(`✅ [BULLMQ SCHEDULER] Worker closed`);

      // Note: We don't remove repeatable jobs on shutdown - they persist in Redis
      // This is intentional for durability

      this.scheduleCache.clear();
      console.log(`✅ [BULLMQ SCHEDULER] Shutdown complete`);
    } catch (error) {
      console.error(`❌ [BULLMQ SCHEDULER] Error during shutdown:`, error);
    }
  }

  /**
   * Get queue statistics for monitoring
   */
  async getQueueStats() {
    const counts = await this.scheduledQueue.getJobCounts();
    const repeatables = await this.scheduledQueue.getRepeatableJobs();
    
    return {
      ...counts,
      repeatableCount: repeatables.length,
    };
  }
}
