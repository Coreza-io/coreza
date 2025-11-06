import * as schedule from 'node-schedule';
import { supabase } from '../config/supabase';
import { executeWorkflow } from './workflowEngine';
import { formatInTimeZone } from 'date-fns-tz';

interface ScheduledJob {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
  job: schedule.Job;
}

class WorkflowScheduler {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();

  async initialize(): Promise<void> {
    console.log('🕐 [SCHEDULER] Initializing workflow scheduler...');
    
    try {
      // Load all active workflows with schedules
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('is_active', true)
        .not('schedule_cron', 'is', null);

      if (error) {
        console.error('❌ [SCHEDULER] Failed to load scheduled workflows:', error);
        return;
      }

      console.log(`📅 [SCHEDULER] Found ${workflows.length} scheduled workflows to initialize`);

      // Schedule each workflow
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
          console.error(`❌ [SCHEDULER] Failed to schedule workflow ${workflow.id}:`, error);
        }
      }

      console.log(`✅ [SCHEDULER] Initialized successfully: ${successCount}/${workflows.length} workflows scheduled`);
    } catch (error) {
      console.error('💥 [SCHEDULER] Critical error during initialization:', error);
    }
  }

  // Helper function to validate cron expression and ensure it's for future execution
  private validateCronExpression(cronExpression: string): { valid: boolean; nextRun?: Date; error?: string } {
    try {
      // Create a test job to validate the cron expression
      const testJob = schedule.scheduleJob('test-validation', cronExpression, () => {});
      
      if (!testJob) {
        return { valid: false, error: 'Invalid cron expression format' };
      }
      
      const nextRaw = testJob.nextInvocation();
      testJob.cancel(); // Clean up test job
      
      const nextRun = this.getFireDate(nextRaw);
      if (!nextRun) {
        return { valid: false, error: 'Unable to determine next run time' };
      }
      
      // Ensure the next run is in the future (at least 1 minute from now)
      const now = new Date();
      const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
      
      if (nextRun <= oneMinuteFromNow) {
        return { valid: false, error: 'Schedule must be set for at least 1 minute in the future' };
      }
      
      return { valid: true, nextRun };
    } catch (error) {
      return { 
        valid: false, 
        error: `Invalid cron expression: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  // Helper to format dates in the configured timezone
  private formatTime(date: Date, timezone?: string): string {
    // Guard invalid Date
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    if (!timezone) {
      return date.toISOString(); // Fallback to UTC if no timezone
    }
    
    try {
      // Use offset token (XXX) which is reliable across platforms, and append IANA name
      const local = formatInTimeZone(date, timezone, 'yyyy-MM-dd HH:mm:ss XXX');
      return `${local} (${timezone})`;
    } catch (error) {
      console.error(`⚠️ [SCHEDULER] Invalid timezone ${timezone}, falling back to UTC:`, error);
      return date.toISOString();
    }
  }

  // Normalize nextInvocation outputs to a Date
  private getFireDate(next: any): Date | undefined {
    if (!next) return undefined;
    if (next instanceof Date) return next;
    if (next.fireDate instanceof Date) return next.fireDate;
    if (typeof next.getTime === 'function') {
      const t = next.getTime();
      if (typeof t === 'number' && !Number.isNaN(t)) return new Date(t);
    }
    if (typeof next.toDate === 'function') {
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
    timezone?: string
  ): Promise<void> {
    // Cancel existing job if it exists
    await this.unscheduleWorkflow(workflowId);

    try {
      console.log(`📅 [SCHEDULER] Creating schedule for workflow ${workflowId} with cron: ${cronExpression}`);
      
      // Validate cron expression
      const validation = this.validateCronExpression(cronExpression);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid cron expression');
      }
      
      console.log(`⏰ [SCHEDULER] Validated cron expression. Next execution: ${this.formatTime(validation.nextRun!, timezone)}`);
      console.log(`🌍 [SCHEDULER] Using timezone: ${timezone || 'Server Local Time'}`);
      
      // Create job with timezone support if provided
      const jobConfig = timezone ? { rule: cronExpression, tz: timezone } : cronExpression;
      const job = schedule.scheduleJob(jobConfig, async () => {
        const executionId = `${workflowId}_${Date.now()}`;
        console.log(`🚀 [SCHEDULER] Starting scheduled execution ${executionId} for workflow ${workflowId} at ${this.formatTime(new Date(), timezone)}`);
        
        let runId = null;
        const startTime = Date.now();
        
        try {
          // Create workflow run
          console.log(`📋 [SCHEDULER] Creating workflow run for ${workflowId}...`);
          const { data: run, error: runError } = await supabase
            .from('workflow_runs')
            .insert({
              workflow_id: workflowId,
              status: 'running',
              initiated_by: userId
            })
            .select()
            .single();

          if (runError) {
            console.error(`❌ [SCHEDULER] Failed to create run for workflow ${workflowId}:`, runError);
            return;
          }

          runId = run.id;
          console.log(`✅ [SCHEDULER] Created workflow run ${runId} for scheduled execution ${executionId}`);

          // Execute workflow with timeout protection
          console.log(`⚡ [SCHEDULER] Starting workflow execution for run ${runId}...`);
          const executionPromise = executeWorkflow(run.id, workflowId, userId, nodes, edges);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Workflow execution timeout (10 minutes)')), 10 * 60 * 1000)
          );

          const result = await Promise.race([executionPromise, timeoutPromise]) as any;
          const executionTime = Date.now() - startTime;
          
          if (result.success) {
            console.log(`✅ [SCHEDULER] Execution ${executionId} completed successfully in ${executionTime}ms - Workflow: ${workflowId}, Run: ${runId}`);
          } else {
            console.error(`❌ [SCHEDULER] Execution ${executionId} failed after ${executionTime}ms - Workflow: ${workflowId}, Run: ${runId}, Error:`, result.error);
          }
        } catch (error) {
          const executionTime = Date.now() - startTime;
          console.error(`💥 [SCHEDULER] Critical error in execution ${executionId} after ${executionTime}ms - Workflow: ${workflowId}:`, error);
          
          // Update run status to failed if we have a runId
          if (runId) {
            try {
              console.log(`🔄 [SCHEDULER] Updating run ${runId} status to failed...`);
              await supabase
                .from('workflow_runs')
                .update({
                  status: 'failed',
                  completed_at: new Date().toISOString(),
                  error_message: error.message || 'Unknown scheduler error'
                })
                .eq('id', runId);
              console.log(`✅ [SCHEDULER] Updated run ${runId} status to failed`);
            } catch (updateError) {
              console.error(`❌ [SCHEDULER] Failed to update failed run ${runId}:`, updateError);
            }
          }
        }
      });

      this.scheduledJobs.set(workflowId, {
        workflowId,
        userId,
        cronExpression,
        timezone,
        job
      });

      const nextRunRaw = job.nextInvocation();
      const nextRunDate = this.getFireDate(nextRunRaw);
      console.log(`✅ [SCHEDULER] Successfully scheduled workflow ${workflowId} - Next execution: ${nextRunDate ? this.formatTime(nextRunDate, timezone) : 'Unknown'}`);
    } catch (error) {
      console.error(`❌ [SCHEDULER] Failed to schedule workflow ${workflowId}:`, error);
      throw error;
    }
  }

  async unscheduleWorkflow(workflowId: string): Promise<void> {
    const scheduledJob = this.scheduledJobs.get(workflowId);
    
    if (scheduledJob) {
      scheduledJob.job.cancel();
      this.scheduledJobs.delete(workflowId);
      const tzInfo = scheduledJob.timezone ? ` in ${scheduledJob.timezone}` : '';
      console.log(`🗑️ [SCHEDULER] Unscheduled workflow: ${workflowId} (was scheduled with: ${scheduledJob.cronExpression}${tzInfo})`);
    } else {
      console.log(`ℹ️ [SCHEDULER] No scheduled job found for workflow: ${workflowId}`);
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
    const tzInfo = timezone ? ` (${timezone})` : '';
    console.log(`🔄 [SCHEDULER] Updating schedule for workflow ${workflowId} - New cron: ${cronExpression || 'UNSCHEDULED'}${tzInfo}`);
    
    if (cronExpression) {
      await this.scheduleWorkflow(workflowId, userId, cronExpression, nodes, edges, timezone);
      console.log(`✅ [SCHEDULER] Schedule updated for workflow ${workflowId}`);
    } else {
      await this.unscheduleWorkflow(workflowId);
      console.log(`✅ [SCHEDULER] Workflow ${workflowId} unscheduled successfully`);
    }
  }

  getScheduledJobs(): ScheduledJob[] {
    const jobs = Array.from(this.scheduledJobs.values());
    console.log(`📊 [SCHEDULER] Currently managing ${jobs.length} scheduled workflows`);
    return jobs;
  }

  async shutdown(): Promise<void> {
    const jobCount = this.scheduledJobs.size;
    console.log(`🛑 [SCHEDULER] Shutting down workflow scheduler - Cancelling ${jobCount} jobs...`);
    
    for (const [workflowId, scheduledJob] of this.scheduledJobs.entries()) {
      try {
        scheduledJob.job.cancel();
        console.log(`✅ [SCHEDULER] Cancelled job for workflow ${workflowId}`);
      } catch (error) {
        console.error(`❌ [SCHEDULER] Failed to cancel job for workflow ${workflowId}:`, error);
      }
    }
    
    this.scheduledJobs.clear();
    console.log(`✅ [SCHEDULER] Shutdown complete - All ${jobCount} jobs cancelled`);
  }
}

// Export singleton instance
export const workflowScheduler = new WorkflowScheduler();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await workflowScheduler.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await workflowScheduler.shutdown();
  process.exit(0);
});