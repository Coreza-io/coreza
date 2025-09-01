import express from 'express';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';
import { executeWorkflow } from '../services/workflowEngine';
import { workflowScheduler } from '../services/scheduler';
import parser from 'cron-parser';

const router = express.Router();

// Get all workflows for a user
router.get('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw createError('Failed to fetch workflows', 500);
    }
    
    res.json({ workflows: data });
  } catch (error) {
    next(error);
  }
});

// Create a new workflow
router.post('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, nodes, edges, project_id, schedule_cron } = req.body;
    
    if (!name || !nodes || !edges) {
      throw createError('Name, nodes, and edges are required', 400);
    }
    
    const { data, error } = await supabase
      .from('workflows')
      .insert({
        user_id: userId,
        name,
        nodes,
        edges,
        project_id,
        schedule_cron,
        is_active: false
      })
      .select()
      .single();
    
    if (error) {
      throw createError('Failed to create workflow', 500);
    }
    
    res.status(201).json({ workflow: data });
  } catch (error) {
    next(error);
  }
});

// Update a workflow
router.put('/:userId/:workflowId', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    const updates = req.body;
    
    const { data, error } = await supabase
      .from('workflows')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) {
      throw createError('Failed to update workflow', 500);
    }
    
    if (!data) {
      throw createError('Workflow not found', 404);
    }
    
    res.json({ workflow: data });
  } catch (error) {
    next(error);
  }
});

// Delete a workflow
router.delete('/:userId/:workflowId', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    
    // Unschedule workflow first
    await workflowScheduler.unscheduleWorkflow(workflowId);
    
    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', workflowId)
      .eq('user_id', userId);
    
    if (error) {
      throw createError('Failed to delete workflow', 500);
    }
    
    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Get workflow runs
router.get('/:userId/:workflowId/runs', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    
    // First verify workflow belongs to user
    const { data: workflow } = await supabase
      .from('workflows')
      .select('id')
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single();
    
    if (!workflow) {
      throw createError('Workflow not found', 404);
    }
    
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('started_at', { ascending: false });
    
    if (error) {
      throw createError('Failed to fetch workflow runs', 500);
    }
    
    res.json({ runs: data });
  } catch (error) {
    next(error);
  }
});

// Execute workflow
router.post('/:userId/:workflowId/execute', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    const { input_data = {} } = req.body;
    
    // First verify workflow belongs to user and is active
    const { data: workflow, error: workflowError } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single();
    
    if (workflowError || !workflow) {
      throw createError('Workflow not found', 404);
    }
    
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
      throw createError('Failed to create workflow run', 500);
    }
    
    // Execute workflow asynchronously
    executeWorkflow(run.id, workflowId, userId, workflow.nodes, workflow.edges)
      .then(async (result) => {
        console.log(`Workflow ${workflowId} execution completed:`, result);
        
        if (!result.success) {
          console.error(`Workflow ${workflowId} failed:`, result.error);
        }
      })
      .catch(async (error) => {
        console.error(`Workflow ${workflowId} execution error:`, error);
        
        // Update run status to failed
        await supabase
          .from('workflow_runs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error.message
          })
          .eq('id', run.id);
      });
    
    res.json({
      run_id: run.id,
      status: 'started',
      message: 'Workflow execution started'
    });
  } catch (error) {
    next(error);
  }
});

type SchedulerValues = {
  mode?: 'every'|'daily'|'weekly'|'monthly'|'cron';
  interval?: 'Minutes'|'Hours'|'Days'|'Weeks'|'Months'|'Cron';
  count?: string | number;
  minute?: string | number;
  hour?: string | number;
  dom?: string | number;
  dow?: Array<string|number>;
  cron?: string;
  timezone?: string;
};

function computeCronFromSchedulerNodes(nodes: any[]) {
  const list = Array.isArray(nodes) ? nodes : [];
  const schedulers = list.filter(n =>
    (n?.type === 'Scheduler') || n?.data?.kind === 'scheduler'
  );

  if (schedulers.length === 0) {
    throw createError('No Scheduler node found in the workflow.', 400);
  }
  if (schedulers.length > 1) {
    throw createError('Multiple Scheduler nodes found. Support one per workflow or aggregate externally.', 400);
  }

  const node = schedulers[0];
  const v: SchedulerValues = (node.values ?? node.data?.values ?? {}) as any;

  const cron = toCronFromValues(v);
  const tz = v.timezone || 'UTC';

  // Validate cron & ensure a future run
  const it = parser.parseExpression(cron, { tz });
  const next = it.next().toDate();
  if (next <= new Date()) {
    throw createError('Computed schedule does not yield a future run. Adjust time or interval.', 400);
  }

  return { cron, timezone: tz, next };
}

function toCronFromValues(v: SchedulerValues): string {
  const interval = (v.interval || v.mode || 'Minutes').toString().toLowerCase();

  const count = clampInt(v.count, 1, 1, 10000);
  const minute = clampInt(v.minute, 0, 0, 59);
  const hour   = clampInt(v.hour,   0, 0, 23);

  if (interval === 'cron' && v.cron) return v.cron;

  switch (interval) {
    case 'minutes':
      // every N minutes
      return `*/${count} * * * *`;

    case 'hours':
      // at :minute, every N hours
      return `${minute} */${count} * * *`;

    case 'days':
      // at hour:minute, every N days
      return `${minute} ${hour} */${count} * *`;

    case 'weeks': {
      // at hour:minute on selected days of week (cron has no "every N weeks" → enforce count===1)
      if (count !== 1) throw createError('Standard cron does not support "every N weeks". Set specific weekdays.', 400);
      const dowList = Array.isArray(v.dow) && v.dow.length
        ? v.dow.map(mapDOW).join(',')
        : '*';
      return `${minute} ${hour} * * ${dowList}`;
    }

    case 'months': {
      // at hour:minute on day-of-month, every N months
      const dom = clampInt(v.dom, 1, 1, 31);
      return `${minute} ${hour} ${dom} */${count} *`;
    }

    // Friendly aliases
    case 'daily':    return `${minute} ${hour} * * *`;
    case 'weekly':   return `${minute} ${hour} * * ${Array.isArray(v.dow)&&v.dow.length?v.dow.map(mapDOW).join(','):'*'}`;
    case 'monthly':  return `${minute} ${hour} ${clampInt(v.dom,1,1,31)} * *`;

    default:
      throw createError(`Unknown scheduler interval/mode: ${v.interval || v.mode}`, 400);
  }
}

function clampInt(x: any, fallback: number, min: number, max: number) {
  const n = Number.parseInt(String(x ?? ''), 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return fallback;
}

function mapDOW(s: string|number) {
  if (typeof s === 'number') return String(s);
  const m = String(s).slice(0,3).toLowerCase();
  const idx = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(m);
  return idx >= 0 ? String(idx) : '*';
}

// Helper function to validate if workflow has Scheduler/Trigger nodes
function hasSchedulerOrTriggerNodes(nodes: any[]): boolean {
  return nodes.some(node => 
    node.type === 'Scheduler' || 
    node.type === 'trigger' || 
    (node.node_type && (node.node_type === 'trigger' || node.node_type === 'Scheduler'))
  );
}

// Helper function to validate cron expression for future scheduling
function validateCronForFutureExecution(cronExpression: string): { valid: boolean; message?: string } {
  try {
    // Parse cron expression to check if it's valid
    const cronParts = cronExpression.split(' ');
    if (cronParts.length !== 5) {
      return { valid: false, message: 'Invalid cron expression format. Expected 5 parts (minute hour day month dayofweek)' };
    }

    // For basic validation, we'll check if the cron would execute in the future
    // This is a simplified check - for production, consider using a cron parsing library
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    const currentDay = now.getDate();
    
    const [minute, hour, day, month, dayOfWeek] = cronParts;
    
    // Check if it's scheduled for a specific future time
    if (hour !== '*' && minute !== '*') {
      const scheduledHour = parseInt(hour);
      const scheduledMinute = parseInt(minute);
      
      if (!isNaN(scheduledHour) && !isNaN(scheduledMinute)) {
        const scheduledTime = new Date(now);
        scheduledTime.setHours(scheduledHour, scheduledMinute, 0, 0);
        
        // If scheduled time is in the past today, it should run tomorrow
        if (scheduledTime <= now) {
          scheduledTime.setDate(scheduledTime.getDate() + 1);
        }
        
        // The scheduled time should be in the future
        return { valid: scheduledTime > now };
      }
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, message: `Invalid cron expression: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Activate/Deactivate workflow scheduling
router.put('/:userId/:workflowId/schedule', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    const { is_active } = req.body ?? {}; // <-- no schedule_cron from client

    // Fetch workflow
    const { data: workflow, error: fetchError } = await supabase
      .from('workflows')
      .select('id,user_id,nodes,edges,is_active,schedule_cron')
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !workflow) throw createError('Workflow not found', 404);

    // If activating, compute cron from Scheduler node
    let cronToSave: string | null = null;
    let tzToUse = 'UTC';
    let nextRun: Date | null = null;

    if (is_active === true) {
      const { cron, timezone, next } = computeCronFromSchedulerNodes(workflow.nodes);
      cronToSave = cron;
      tzToUse = timezone ?? 'UTC';
      nextRun = next;
    }

    // Persist (null out cron when deactivating)
    const { data: updated, error: updateError } = await supabase
      .from('workflows')
      .update({
        is_active: !!is_active,
        schedule_cron: is_active ? cronToSave : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workflowId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError || !updated) throw createError('Failed to update workflow', 500);

    // Apply side effect with compensation
    try {
      if (is_active) {
        await workflowScheduler.scheduleWorkflow(
          workflowId,
          userId,
          cronToSave!,
          updated.nodes,
          updated.edges
        );
      } else {
        await workflowScheduler.unscheduleWorkflow(workflowId);
      }
    } catch (e: any) {
      // rollback active flag if scheduler failed
      await supabase
        .from('workflows')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', workflowId)
        .eq('user_id', userId);
      throw createError(`Scheduling operation failed: ${e.message}`, 502);
    }

    res.json({
      workflow: updated,
      next_run_at: is_active ? nextRun : null,
      message: is_active ? 'Workflow scheduled from Scheduler node' : 'Workflow unscheduled',
    });
  } catch (err) {
    next(err);
  }
});

// Get scheduler status
router.get('/scheduler/status', async (req, res, next) => {
  try {
    const scheduledJobs = workflowScheduler.getScheduledJobs();
    
    res.json({
      status: 'active',
      scheduled_workflows: scheduledJobs.length,
      jobs: scheduledJobs.map(job => ({
        workflow_id: job.workflowId,
        user_id: job.userId,
        cron_expression: job.cronExpression,
        next_run: job.job.nextInvocation()
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Get node execution details for a workflow run
router.get('/:userId/:workflowId/runs/:runId/executions', async (req, res, next) => {
  try {
    const { userId, workflowId, runId } = req.params;
    
    // Verify workflow belongs to user
    const { data: workflow } = await supabase
      .from('workflows')
      .select('id')
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single();
    
    if (!workflow) {
      throw createError('Workflow not found', 404);
    }
    
    // Get node executions
    const { data, error } = await supabase
      .from('node_executions')
      .select('*')
      .eq('run_id', runId)
      .order('started_at', { ascending: true });
    
    if (error) {
      throw createError('Failed to fetch node executions', 500);
    }
    
    res.json({ executions: data });
  } catch (error) {
    next(error);
  }
});

// Get workflow run status
router.get('/:userId/:workflowId/runs/:runId/status', async (req, res, next) => {
  try {
    const { userId, workflowId, runId } = req.params;
    
    // Verify workflow belongs to user
    const { data: workflow } = await supabase
      .from('workflows')
      .select('id')
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single();
    
    if (!workflow) {
      throw createError('Workflow not found', 404);
    }
    
    // Get workflow run
    const { data: run, error: runError } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('id', runId)
      .single();
    
    if (runError || !run) {
      throw createError('Workflow run not found', 404);
    }
    
    // Get node executions count
    const { count, error: countError } = await supabase
      .from('node_executions')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);
    
    if (countError) {
      console.error('Failed to count node executions:', countError);
    }
    
    res.json({
      run,
      node_executions_count: count || 0
    });
  } catch (error) {
    next(error);
  }
});

export default router;