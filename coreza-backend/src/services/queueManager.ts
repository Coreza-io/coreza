import Redis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { supabase } from '../config/supabase';
import { executeWorkflow } from './workflowEngine';
import { WebSocketManager } from './websocketManager';

// Redis connection configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // BullMQ requires this to be null
  retryDelayOnFailover: 100,
});

// Queue instances
export const workflowQueue = new Queue('workflow-execution', { connection: redis });
export const scheduledQueue = new Queue('scheduled-workflows', { connection: redis });
export const agentQueue = new Queue('agent-processing', { connection: redis });
export const notificationQueue = new Queue('notifications', { connection: redis });

// Job data interfaces
interface WorkflowJobData {
  runId: string;
  workflowId: string;
  userId: string;
  nodes: any[];
  edges: any[];
  trigger?: 'manual' | 'scheduled' | 'webhook';
}

interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
}

interface AgentJobData {
  sessionId: string;
  userId: string;
  input: string;
  context?: any;
}

interface NotificationJobData {
  userId: string;
  type: 'email' | 'sms' | 'webhook' | 'websocket';
  data: any;
}

// Workflow execution worker
const workflowWorker = new Worker(
  'workflow-execution',
  async (job: Job<WorkflowJobData>) => {
    const { runId, nodes, edges, userId, workflowId } = job.data;
    
    console.log(`🚀 Processing workflow job ${job.id} for run ${runId}`);
    
    try {
      // Update run status to running
      await supabase
        .from('workflow_runs')
        .update({ status: 'running' })
        .eq('id', runId);

      // Execute workflow
      const result = await executeWorkflow(runId, workflowId, userId, nodes, edges);
      
      // Send real-time update
      WebSocketManager.sendToUser(userId, {
        type: 'workflow_completed',
        runId,
        success: result.success,
        result: result.result,
        error: result.error
      });

      return result;
    } catch (error) {
      console.error(`❌ Workflow execution failed for run ${runId}:`, error);
      
      // Send real-time error update
      WebSocketManager.sendToUser(userId, {
        type: 'workflow_failed',
        runId,
        error: error.message
      });
      
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: parseInt(process.env.WORKFLOW_JOB_CONCURRENCY || '5'),
    removeOnComplete: 50,
    removeOnFail: 100
  }
);

// Scheduled workflow worker
const scheduledWorker = new Worker(
  'scheduled-workflows',
  async (job: Job<ScheduledWorkflowJobData>) => {
    const { workflowId, userId } = job.data;
    
    console.log(`⏰ Processing scheduled workflow ${workflowId}`);
    
    try {
      // Get workflow details
      const { data: workflow, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .eq('is_active', true)
        .single();

      if (error || !workflow) {
        console.error(`Workflow ${workflowId} not found or not active`);
        return;
      }

      // Create workflow run
      const { data: run, error: runError } = await supabase
        .from('workflow_runs')
        .insert({
          workflow_id: workflowId,
          status: 'queued',
          initiated_by: userId
        })
        .select()
        .single();

      if (runError) {
        throw new Error(`Failed to create workflow run: ${runError.message}`);
      }

      // Queue workflow execution
      await workflowQueue.add('execute-workflow', {
        runId: run.id,
        workflowId,
        userId,
        nodes: workflow.nodes,
        edges: workflow.edges,
        trigger: 'scheduled'
      });

      return { runId: run.id };
    } catch (error) {
      console.error(`❌ Scheduled workflow failed for ${workflowId}:`, error);
      throw error;
    }
  },
  { 
    connection: redis,
    concurrency: 10
  }
);

// Agent processing worker
const agentWorker = new Worker(
  'agent-processing',
  async (job: Job<AgentJobData>) => {
    const { sessionId, userId, input, context } = job.data;
    
    console.log(`🤖 Processing agent job for session ${sessionId}`);
    
    try {
      // This will be implemented with Langchain.js
      const response = await processAgentRequest(input, context);
      
      // Send real-time response
      WebSocketManager.sendToUser(userId, {
        type: 'agent_response',
        sessionId,
        response
      });

      return response;
    } catch (error) {
      console.error(`❌ Agent processing failed for session ${sessionId}:`, error);
      throw error;
    }
  },
  { 
    connection: redis,
    concurrency: 3
  }
);

// Notification worker
const notificationWorker = new Worker(
  'notifications',
  async (job: Job<NotificationJobData>) => {
    const { userId, type, data } = job.data;
    
    console.log(`📧 Processing notification for user ${userId}, type: ${type}`);
    
    try {
      switch (type) {
        case 'email':
          await sendEmailNotification(data);
          break;
        case 'sms':
          await sendSMSNotification(data);
          break;
        case 'webhook':
          await sendWebhookNotification(data);
          break;
        case 'websocket':
          WebSocketManager.sendToUser(userId, data);
          break;
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      return { success: true };
    } catch (error) {
      console.error(`❌ Notification failed for user ${userId}:`, error);
      throw error;
    }
  },
  { 
    connection: redis,
    concurrency: 20
  }
);

// Queue management functions
export class QueueManager {
  static async addWorkflowExecution(data: WorkflowJobData): Promise<Job> {
    return await workflowQueue.add('execute-workflow', data, {
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      }
    });
  }

  static async scheduleWorkflow(workflowId: string, userId: string, cronExpression: string): Promise<Job> {
    // Remove existing scheduled job
    await this.unscheduleWorkflow(workflowId);
    
    // Add new scheduled job
    return await scheduledQueue.add(
      `scheduled-${workflowId}`,
      { workflowId, userId, cronExpression },
      {
        repeat: { pattern: cronExpression },
        jobId: `scheduled-${workflowId}`,
        removeOnComplete: 10,
        removeOnFail: 50
      }
    );
  }

  static async unscheduleWorkflow(workflowId: string): Promise<void> {
    const jobId = `scheduled-${workflowId}`;
    await scheduledQueue.removeRepeatable(jobId, { pattern: '*' });
    
    // Remove any existing jobs
    const jobs = await scheduledQueue.getJobs(['waiting', 'delayed']);
    for (const job of jobs) {
      if (job.id === jobId) {
        await job.remove();
      }
    }
  }

  static async addAgentProcessing(data: AgentJobData): Promise<Job> {
    return await agentQueue.add('process-agent', data, {
      removeOnComplete: 20,
      removeOnFail: 50,
      attempts: 2
    });
  }

  static async addNotification(data: NotificationJobData): Promise<Job> {
    return await notificationQueue.add('send-notification', data, {
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 1000,
      }
    });
  }

  static async getQueueStats() {
    const [workflowStats, scheduledStats, agentStats, notificationStats] = await Promise.all([
      workflowQueue.getJobCounts(),
      scheduledQueue.getJobCounts(),
      agentQueue.getJobCounts(),
      notificationQueue.getJobCounts()
    ]);

    return {
      workflow: workflowStats,
      scheduled: scheduledStats,
      agent: agentStats,
      notification: notificationStats
    };
  }

  static async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up queues...');
    
    await Promise.all([
      workflowWorker.close(),
      scheduledWorker.close(),
      agentWorker.close(),
      notificationWorker.close()
    ]);
    
    await redis.quit();
    console.log('✅ Queue cleanup completed');
  }
}

// Placeholder functions (to be implemented)
async function processAgentRequest(input: string, context: any): Promise<any> {
  // TODO: Implement with Langchain.js
  return { response: `Processed: ${input}`, context };
}

async function sendEmailNotification(data: any): Promise<void> {
  // TODO: Implement email sending
  console.log('📧 Email notification:', data);
}

async function sendSMSNotification(data: any): Promise<void> {
  // TODO: Implement SMS sending
  console.log('📱 SMS notification:', data);
}

async function sendWebhookNotification(data: any): Promise<void> {
  // TODO: Implement webhook sending
  console.log('🔗 Webhook notification:', data);
}

// Event listeners for monitoring
workflowWorker.on('completed', (job) => {
  console.log(`✅ Workflow job ${job.id} completed`);
});

workflowWorker.on('failed', (job, err) => {
  console.error(`❌ Workflow job ${job?.id} failed:`, err.message);
});

scheduledWorker.on('completed', (job) => {
  console.log(`⏰ Scheduled job ${job.id} completed`);
});

export { redis };

// Graceful shutdown
process.on('SIGINT', async () => {
  await QueueManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await QueueManager.cleanup();
  process.exit(0);
});