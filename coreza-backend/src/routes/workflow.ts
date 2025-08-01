import express from 'express';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';
import { executeWorkflow } from '../services/workflowEngine';
import { workflowScheduler } from '../services/scheduler';

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

// Activate/Deactivate workflow scheduling
router.put('/:userId/:workflowId/schedule', async (req, res, next) => {
  try {
    const { userId, workflowId } = req.params;
    const { is_active, schedule_cron } = req.body;
    
    // Update workflow
    const { data: workflow, error } = await supabase
      .from('workflows')
      .update({
        is_active,
        schedule_cron,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error || !workflow) {
      throw createError('Workflow not found', 404);
    }
    
    // Update scheduler
    if (is_active && schedule_cron) {
      await workflowScheduler.scheduleWorkflow(
        workflowId,
        userId,
        schedule_cron,
        workflow.nodes,
        workflow.edges
      );
    } else {
      await workflowScheduler.unscheduleWorkflow(workflowId);
    }
    
    res.json({
      workflow,
      message: is_active ? 'Workflow scheduled successfully' : 'Workflow unscheduled successfully'
    });
  } catch (error) {
    next(error);
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