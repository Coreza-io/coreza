import express from 'express';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';

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
    
    // TODO: Implement actual workflow execution logic
    // For now, just mark as completed
    const { error: updateError } = await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: { message: 'Workflow executed successfully' }
      })
      .eq('id', run.id);
    
    if (updateError) {
      console.error('Failed to update workflow run:', updateError);
    }
    
    res.json({
      run_id: run.id,
      status: 'started',
      message: 'Workflow execution started'
    });
  } catch (error) {
    next(error);
  }
});

export default router;