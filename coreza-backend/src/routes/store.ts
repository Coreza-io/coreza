import express from 'express';
import { getRedis } from '../config/redis';
import { supabase } from '../config/supabase';
import logger from '../utils/logger';
import { 
  buildStoreKey, 
  extractVariableNameFromKey, 
  parseStoredValue,
  parseMembers,
  parseScoreMembers 
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

    res.json({
      success: true,
      variables: keys.map(extractVariableNameFromKey),
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
    const key = buildStoreKey(user_id as string, workflow_id as string, variable_name as string);
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

// POST /store/execute - Execute comprehensive store operations
router.post('/execute', async (req, res) => {
  try {
    const { 
      user_id, 
      workflow_id,
      dataType,
      operation, 
      variableName,
      variableNameManual,
      variableNameSelect,
      variableSource,
      sourceWorkflowId,
      value,
      hashField,
      members,
      member,
      score,
      scoreMembers,
      startIndex,
      endIndex,
      index,
      incrementBy,
      minScore,
      maxScore,
      pattern,
      otherKeys,
      withScores,
      reverseOrder,
      ttl 
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const redis = getRedis();
    
    // Determine variable name: manual entry, dropdown select, or write operation
    const varName = variableNameManual || variableNameSelect || variableName;
    
    // Determine workflow: for manual source, use current workflow; for store source, use selected workflow
    const targetWorkflowId = (variableSource === 'store' && sourceWorkflowId) 
      ? sourceWorkflowId 
      : workflow_id;

    // Helper to apply TTL
    const applyTTL = async (key: string) => {
      if (ttl && ttl > 0) {
        await redis.expire(key, ttl);
      }
    };

    // ============ STRING OPERATIONS ============
    if (operation === 'set') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required for set' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttl && ttl > 0) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }

      return res.json({ success: true, operation: 'set', variableName, message: 'Value saved' });
    }

    if (operation === 'get') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const rawValue = await redis.get(key);
      return res.json({ success: true, operation: 'get', variableName: varName, value: parseStoredValue(rawValue) });
    }

    if (operation === 'delete') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      await redis.del(key);
      return res.json({ success: true, operation: 'delete', variableName: varName, message: 'Key deleted' });
    }

    if (operation === 'increment') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newValue = await redis.incrby(key, amount);
      return res.json({ success: true, operation: 'increment', variableName: varName, value: newValue });
    }

    if (operation === 'append') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      await redis.append(key, value || '');
      return res.json({ success: true, operation: 'append', variableName: varName, message: 'Value appended' });
    }

    // ============ LIST OPERATIONS ============
    if (operation === 'lpush') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.lpush(key, serialized);
      await applyTTL(key);
      return res.json({ success: true, operation: 'lpush', variableName, message: 'Value pushed left' });
    }

    if (operation === 'rpush') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.rpush(key, serialized);
      await applyTTL(key);
      return res.json({ success: true, operation: 'rpush', variableName, message: 'Value pushed right' });
    }

    if (operation === 'lpop') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const popped = await redis.lpop(key);
      return res.json({ success: true, operation: 'lpop', variableName: varName, value: parseStoredValue(popped) });
    }

    if (operation === 'rpop') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const popped = await redis.rpop(key);
      return res.json({ success: true, operation: 'rpop', variableName: varName, value: parseStoredValue(popped) });
    }

    if (operation === 'lrange') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      const items = await redis.lrange(key, start, end);
      return res.json({ success: true, operation: 'lrange', variableName: varName, value: items.map(parseStoredValue) });
    }

    if (operation === 'llen') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const length = await redis.llen(key);
      return res.json({ success: true, operation: 'llen', variableName: varName, value: length });
    }

    if (operation === 'lindex') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const item = await redis.lindex(key, index ?? 0);
      return res.json({ success: true, operation: 'lindex', variableName: varName, value: parseStoredValue(item) });
    }

    if (operation === 'lset') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.lset(key, index ?? 0, serialized);
      return res.json({ success: true, operation: 'lset', variableName, message: 'Value set at index' });
    }

    if (operation === 'ltrim') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      await redis.ltrim(key, start, end);
      return res.json({ success: true, operation: 'ltrim', variableName: varName, message: 'List trimmed' });
    }

    // ============ HASH OPERATIONS ============
    if (operation === 'hset') {
      if (!workflow_id || !variableName || !hashField) {
        return res.status(400).json({ error: 'workflow_id, variableName, and hashField required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.hset(key, hashField, serialized);
      await applyTTL(key);
      return res.json({ success: true, operation: 'hset', variableName, hashField, message: 'Hash field set' });
    }

    if (operation === 'hget') {
      if (!targetWorkflowId || !varName || !hashField) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and hashField required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const fieldValue = await redis.hget(key, hashField);
      return res.json({ success: true, operation: 'hget', variableName: varName, hashField, value: parseStoredValue(fieldValue) });
    }

    if (operation === 'hgetall') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const hash = await redis.hgetall(key);
      const parsed: Record<string, any> = {};
      for (const [field, val] of Object.entries(hash)) {
        parsed[field] = parseStoredValue(val);
      }
      return res.json({ success: true, operation: 'hgetall', variableName: varName, value: parsed });
    }

    if (operation === 'hdel') {
      if (!targetWorkflowId || !varName || !hashField) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and hashField required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      await redis.hdel(key, hashField);
      return res.json({ success: true, operation: 'hdel', variableName: varName, hashField, message: 'Hash field deleted' });
    }

    if (operation === 'hkeys') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const keys = await redis.hkeys(key);
      return res.json({ success: true, operation: 'hkeys', variableName: varName, value: keys });
    }

    if (operation === 'hvals') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const vals = await redis.hvals(key);
      return res.json({ success: true, operation: 'hvals', variableName: varName, value: vals.map(parseStoredValue) });
    }

    if (operation === 'hexists') {
      if (!targetWorkflowId || !varName || !hashField) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and hashField required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const exists = await redis.hexists(key, hashField);
      return res.json({ success: true, operation: 'hexists', variableName: varName, hashField, value: exists === 1 });
    }

    if (operation === 'hincrby') {
      if (!targetWorkflowId || !varName || !hashField) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and hashField required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newValue = await redis.hincrby(key, hashField, amount);
      return res.json({ success: true, operation: 'hincrby', variableName: varName, hashField, value: newValue });
    }

    // ============ SET OPERATIONS ============
    if (operation === 'sadd') {
      if (!workflow_id || !variableName || !members) {
        return res.status(400).json({ error: 'workflow_id, variableName, and members required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      const memberArray = parseMembers(members);
      await redis.sadd(key, ...memberArray);
      await applyTTL(key);
      return res.json({ success: true, operation: 'sadd', variableName, message: 'Members added to set' });
    }

    if (operation === 'srem') {
      if (!targetWorkflowId || !varName || !members) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and members required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const memberArray = parseMembers(members);
      await redis.srem(key, ...memberArray);
      return res.json({ success: true, operation: 'srem', variableName: varName, message: 'Members removed from set' });
    }

    if (operation === 'smembers') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const memberSet = await redis.smembers(key);
      return res.json({ success: true, operation: 'smembers', variableName: varName, value: memberSet });
    }

    if (operation === 'sismember') {
      if (!targetWorkflowId || !varName || !member) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and member required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const isMember = await redis.sismember(key, member);
      return res.json({ success: true, operation: 'sismember', variableName: varName, member, value: isMember === 1 });
    }

    if (operation === 'scard') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const count = await redis.scard(key);
      return res.json({ success: true, operation: 'scard', variableName: varName, value: count });
    }

    if (operation === 'sinter') {
      if (!targetWorkflowId || !varName || !otherKeys) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and otherKeys required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const otherKeyArray = parseMembers(otherKeys).map(k => buildStoreKey(user_id, targetWorkflowId, k));
      const intersection = await redis.sinter(key, ...otherKeyArray);
      return res.json({ success: true, operation: 'sinter', variableName: varName, value: intersection });
    }

    if (operation === 'sunion') {
      if (!targetWorkflowId || !varName || !otherKeys) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and otherKeys required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const otherKeyArray = parseMembers(otherKeys).map(k => buildStoreKey(user_id, targetWorkflowId, k));
      const union = await redis.sunion(key, ...otherKeyArray);
      return res.json({ success: true, operation: 'sunion', variableName: varName, value: union });
    }

    if (operation === 'sdiff') {
      if (!targetWorkflowId || !varName || !otherKeys) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and otherKeys required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const otherKeyArray = parseMembers(otherKeys).map(k => buildStoreKey(user_id, targetWorkflowId, k));
      const diff = await redis.sdiff(key, ...otherKeyArray);
      return res.json({ success: true, operation: 'sdiff', variableName: varName, value: diff });
    }

    // ============ SORTED SET OPERATIONS ============
    if (operation === 'zadd') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required' });
      }
      const key = buildStoreKey(user_id, workflow_id, variableName);
      
      if (scoreMembers) {
        const pairs = parseScoreMembers(scoreMembers);
        await redis.zadd(key, ...pairs);
      } else if (score !== undefined && member) {
        await redis.zadd(key, score, member);
      } else {
        return res.status(400).json({ error: 'Either scoreMembers or (score and member) required' });
      }
      
      await applyTTL(key);
      return res.json({ success: true, operation: 'zadd', variableName, message: 'Members added to sorted set' });
    }

    if (operation === 'zrange') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      
      let result;
      if (withScores) {
        const itemsWithScores = await redis.zrange(key, start, end, 'WITHSCORES');
        const formatted = [];
        for (let i = 0; i < itemsWithScores.length; i += 2) {
          formatted.push({ member: itemsWithScores[i], score: parseFloat(itemsWithScores[i + 1]) });
        }
        result = formatted;
      } else {
        result = await redis.zrange(key, start, end);
      }
      
      if (reverseOrder) {
        result = result.reverse();
      }
      
      return res.json({ success: true, operation: 'zrange', variableName: varName, value: result });
    }

    if (operation === 'zscore') {
      if (!targetWorkflowId || !varName || !member) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and member required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const memberScore = await redis.zscore(key, member);
      return res.json({ success: true, operation: 'zscore', variableName: varName, member, value: memberScore ? parseFloat(memberScore) : null });
    }

    if (operation === 'zcount') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const min = minScore !== undefined ? minScore.toString() : '-inf';
      const max = maxScore !== undefined ? maxScore.toString() : '+inf';
      const count = await redis.zcount(key, min, max);
      return res.json({ success: true, operation: 'zcount', variableName: varName, value: count });
    }

    if (operation === 'zincrby') {
      if (!targetWorkflowId || !varName || !member) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and member required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newScore = await redis.zincrby(key, amount, member);
      return res.json({ success: true, operation: 'zincrby', variableName: varName, member, value: parseFloat(newScore) });
    }

    if (operation === 'zrem') {
      if (!targetWorkflowId || !varName || !members) {
        return res.status(400).json({ error: 'sourceWorkflowId, variableNameSelect, and members required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const memberArray = parseMembers(members);
      await redis.zrem(key, ...memberArray);
      return res.json({ success: true, operation: 'zrem', variableName: varName, message: 'Members removed from sorted set' });
    }

    // ============ UTILITY OPERATIONS ============
    if (operation === 'keys') {
      if (!workflow_id || !variableName) {
        return res.status(400).json({ error: 'workflow_id and variableName required' });
      }
      const searchPattern = pattern || '*';
      const fullPattern = buildStoreKey(user_id, workflow_id, searchPattern);
      const matchedKeys = await redis.keys(fullPattern);
      return res.json({ success: true, operation: 'keys', value: matchedKeys.map(extractVariableNameFromKey) });
    }

    if (operation === 'exists') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const exists = await redis.exists(key);
      return res.json({ success: true, operation: 'exists', variableName: varName, value: exists === 1 });
    }

    if (operation === 'expire') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      if (!ttl || ttl <= 0) {
        return res.status(400).json({ error: 'ttl must be greater than 0 for expire operation' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      await redis.expire(key, ttl);
      return res.json({ success: true, operation: 'expire', variableName: varName, message: `TTL set to ${ttl} seconds` });
    }

    if (operation === 'ttl') {
      if (!targetWorkflowId || !varName) {
        return res.status(400).json({ error: 'sourceWorkflowId and variableNameSelect required' });
      }
      const key = buildStoreKey(user_id, targetWorkflowId, varName);
      const remaining = await redis.ttl(key);
      return res.json({ success: true, operation: 'ttl', variableName: varName, value: remaining });
    }

    return res.status(400).json({ error: `Unknown operation: ${operation}` });

  } catch (error) {
    logger.error({ err: error }, 'Store operation error');
    res.status(500).json({ error: 'Store operation failed' });
  }
});

export default router;
