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
    console.log('🕐 Initializing workflow scheduler...');
    
    try {
      // Load all active workflows with schedules
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('is_active', true)
        .not('schedule_cron', 'is', null);

      if (error) {
        console.error('Failed to load scheduled workflows:', error);
        return;
      }

      console.log(`📅 Found ${workflows.length} scheduled workflows`);

      // Schedule each workflow
      for (const workflow of workflows) {
        await this.scheduleWorkflow(
          workflow.id,
          workflow.user_id,
          workflow.schedule_cron,
          workflow.nodes,
          workflow.edges
        );
      }

      console.log('✅ Workflow scheduler initialized successfully');
    } catch (error) {
      console.error('Failed to initialize scheduler:', error);
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
      const job = schedule.scheduleJob(cronExpression, async () => {
        console.log(`🚀 Executing scheduled workflow: ${workflowId} at ${new Date().toISOString()}`);
        
        let runId = null;
        try {
          // Create workflow run
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
            console.error(`❌ Failed to create run for workflow ${workflowId}:`, runError);
            // Log to scheduler error tracking if we add it later
            return;
          }

          runId = run.id;
          console.log(`📋 Created workflow run ${runId} for scheduled workflow ${workflowId}`);

          // Execute workflow with timeout protection
          const executionPromise = executeWorkflow(run.id, nodes, edges);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Workflow execution timeout (10 minutes)')), 10 * 60 * 1000)
          );

          const result = await Promise.race([executionPromise, timeoutPromise]) as any;
          
          if (result.success) {
            console.log(`✅ Scheduled workflow ${workflowId} (run ${runId}) completed successfully`);
          } else {
            console.error(`❌ Scheduled workflow ${workflowId} (run ${runId}) failed:`, result.error);
          }
        } catch (error) {
          console.error(`💥 Critical error executing scheduled workflow ${workflowId}:`, error);
          
          // Update run status to failed if we have a runId
          if (runId) {
            try {
              await supabase
                .from('workflow_runs')
                .update({
                  status: 'failed',
                  completed_at: new Date().toISOString(),
                  error_message: error.message || 'Unknown scheduler error'
                })
                .eq('id', runId);
            } catch (updateError) {
              console.error(`Failed to update failed run ${runId}:`, updateError);
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

      console.log(`📅 Scheduled workflow ${workflowId} with cron: ${cronExpression}`);
    } catch (error) {
      console.error(`Failed to schedule workflow ${workflowId}:`, error);
      throw error;
    }
  }

  async unscheduleWorkflow(workflowId: string): Promise<void> {
    const scheduledJob = this.scheduledJobs.get(workflowId);
    
    if (scheduledJob) {
      scheduledJob.job.cancel();
      this.scheduledJobs.delete(workflowId);
      console.log(`🗑️ Unscheduled workflow: ${workflowId}`);
    }
  }

  async updateWorkflowSchedule(
    workflowId: string,
    userId: string,
    cronExpression: string | null,
    nodes: any[],
    edges: any[]
  ): Promise<void> {
    if (cronExpression) {
      await this.scheduleWorkflow(workflowId, userId, cronExpression, nodes, edges);
    } else {
      await this.unscheduleWorkflow(workflowId);
    }
  }

  getScheduledJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values());
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down workflow scheduler...');
    
    for (const scheduledJob of this.scheduledJobs.values()) {
      scheduledJob.job.cancel();
    }
    
    this.scheduledJobs.clear();
    console.log('✅ Workflow scheduler shut down');
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