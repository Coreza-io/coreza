import express from 'express';
import { getRedis } from '../config/redis';
import { supabase } from '../config/supabase';
import logger from '../utils/logger';
import {
  buildStoreKey,
  extractVariableNameFromKey,
  normalizeVariableName,
  parseStoredValue,
  resolveStoreKey,
} from '../utils/store';

const router = express.Router();

// GET /store/workflows - List workflows for the authenticated user
router.get('/workflows', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { data, error } = await supabase
      .from('workflows')
      .select('id, name')
      .eq('user_id', user_id)
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      workflows: data?.map((workflow) => ({ id: workflow.id, name: workflow.name })) ?? [],
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing workflows');
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

// GET /store/variables - List stored variable names for a workflow
router.get('/variables', async (req, res) => {
  try {
    const { user_id, workflow_id } = req.query;

    if (!user_id || !workflow_id) {
      return res.status(400).json({ error: 'user_id and workflow_id are required' });
    }

    const redis = getRedis();
    const pattern = buildStoreKey(user_id as string, workflow_id as string, '*');
    const keys = await redis.keys(pattern);

    const variables = Array.from(
      new Set(keys.map((key) => normalizeVariableName(extractVariableNameFromKey(key))))
    );

    res.json({
      success: true,
      variables,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing variables');
    res.status(500).json({ error: 'Failed to list variables' });
  }
});

// GET /store/value - Retrieve a value from another workflow
router.get('/value', async (req, res) => {
  try {
    const { user_id, workflow_id, variable_name } = req.query;

    if (!user_id || !workflow_id || !variable_name) {
      return res
        .status(400)
        .json({ error: 'user_id, workflow_id, and variable_name required' });
    }

    const redis = getRedis();
    const key = await resolveStoreKey(
      getRedis(),
      user_id as string,
      workflow_id as string,
      variable_name as string
    );
    const rawValue = await redis.get(key);

    res.json({
      success: true,
      value: parseStoredValue(rawValue),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching store value');
    res.status(500).json({ error: 'Failed to fetch value' });
  }
});

// POST /store/execute - Execute store operations for the current workflow
router.post('/execute', async (req, res) => {
  try {
    const { user_id, workflow_id, operation, variableName, value, ttl } = req.body;

    if (!user_id || !workflow_id) {
      return res.status(400).json({ error: 'user_id and workflow_id are required' });
    }

    const redis = getRedis();

    switch (operation) {
      case 'set': {
        if (!variableName) {
          return res.status(400).json({ error: 'variableName is required for set' });
        }

        const key = buildStoreKey(user_id, workflow_id, variableName);
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);

        if (ttl && ttl > 0) {
          await redis.setex(key, ttl, serialized);
        } else {
          await redis.set(key, serialized);
        }

        return res.json({
          success: true,
          operation: 'set',
          variableName,
          message: 'Variable saved',
        });
      }

      case 'get': {
        if (!variableName) {
          return res.status(400).json({ error: 'variableName is required for get' });
        }

        const key = await resolveStoreKey(redis, user_id, workflow_id, variableName);
        const rawValue = await redis.get(key);

        return res.json({
          success: true,
          operation: 'get',
          variableName,
          value: parseStoredValue(rawValue),
        });
      }

      case 'delete': {
        if (!variableName) {
          return res.status(400).json({ error: 'variableName is required for delete' });
        }

        const key = await resolveStoreKey(redis, user_id, workflow_id, variableName);
        await redis.del(key);

        return res.json({
          success: true,
          operation: 'delete',
          variableName,
          message: 'Variable deleted',
        });
      }

      case 'list': {
        const pattern = buildStoreKey(user_id, workflow_id, '*');
        const keys = await redis.keys(pattern);
        const variables = Array.from(
          new Set(keys.map((key) => normalizeVariableName(extractVariableNameFromKey(key))))
        );

        return res.json({
          success: true,
          operation: 'list',
          variables,
        });
      }

      default:
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
    }
  } catch (error) {
    logger.error({ err: error }, 'Store operation error');
    res.status(500).json({ error: 'Store operation failed' });
  }
});

export default router;
