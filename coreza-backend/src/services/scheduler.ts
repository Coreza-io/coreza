import * as schedule from 'node-schedule';
import { supabase } from '../config/supabase';
import { executeWorkflow } from './workflowEngine';

interface ScheduledJob {
  workflowId: string;
  userId: string;
  cronExpression: string;
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

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string,
    nodes: any[],
    edges: any[]
  ): Promise<void> {
    // Cancel existing job if it exists
    await this.unscheduleWorkflow(workflowId);

    try {
      console.log(`📅 [SCHEDULER] Creating schedule for workflow ${workflowId} with cron: ${cronExpression}`);
      
      const job = schedule.scheduleJob(cronExpression, async () => {
        const executionId = `${workflowId}_${Date.now()}`;
        console.log(`🚀 [SCHEDULER] Starting scheduled execution ${executionId} for workflow ${workflowId} at ${new Date().toISOString()}`);
        
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
          const executionPromise = executeWorkflow(run.id, nodes, edges);
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
        job
      });

      const nextRun = job.nextInvocation();
      console.log(`✅ [SCHEDULER] Successfully scheduled workflow ${workflowId} - Next execution: ${nextRun?.toISOString() || 'Unknown'}`);
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
      console.log(`🗑️ [SCHEDULER] Unscheduled workflow: ${workflowId} (was scheduled with: ${scheduledJob.cronExpression})`);
    } else {
      console.log(`ℹ️ [SCHEDULER] No scheduled job found for workflow: ${workflowId}`);
    }
  }

  async updateWorkflowSchedule(
    workflowId: string,
    userId: string,
    cronExpression: string | null,
    nodes: any[],
    edges: any[]
  ): Promise<void> {
    console.log(`🔄 [SCHEDULER] Updating schedule for workflow ${workflowId} - New cron: ${cronExpression || 'UNSCHEDULED'}`);
    
    if (cronExpression) {
      await this.scheduleWorkflow(workflowId, userId, cronExpression, nodes, edges);
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