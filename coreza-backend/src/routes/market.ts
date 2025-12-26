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

import express from 'express';
import { requireAuth } from '../middleware/jwtAuth';
import { DataService } from '../services/data';
import { SubscriptionService } from '../services/SubscriptionService';
import { MarketSource } from '../types/marketEvent';
import { getRedisCache } from '../config/redis';
import { supabase } from '../config/supabase';
import { SOURCE_TO_MARKET_SOURCE, getMarketSource } from '../config/marketSources';
import { getAllowedSymbols } from '../utils/streamFilters';
import {
  MAX_TEST_LISTENERS_PER_USER,
  TEST_LISTENER_TTL_SECONDS,
  REDIS_KEY_ACTIVE_TEST_LISTENERS,
  REDIS_KEY_USER_TEST_LISTENERS_PREFIX,
  REDIS_KEY_USER_TEST_COUNT_PREFIX,
  LUA_INCREMENT_TEST_COUNT,
  LUA_DECREMENT_TEST_COUNT,
} from '../config/streaming';
import {
  StreamExecutionRequest,
  StreamExecutionResponse,
  resolveSourceFromNodeType,
} from '../types/streaming';
const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// ============================================
// MARKET DATA SUBSCRIPTION STATUS
// ============================================

/**
 * Get all active market data subscriptions and their status
 * GET /market/subscriptions/status
 */
router.get('/subscriptions/status', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisCache();
    
    // Get all gateway states
    const gatewayKeys = await redis.keys('md:gateway:*:state');
    const sources: any[] = [];
    
    for (const key of gatewayKeys) {
      const stateStr = await redis.get(key);
      if (stateStr) {
        try {
          const state = JSON.parse(stateStr);
          const sourceMatch = key.match(/md:gateway:(\w+):state/);
          if (sourceMatch) {
            sources.push({
              source: sourceMatch[1],
              connected: state.connected || false,
              symbols: state.symbols || [],
              eventTypes: state.eventTypes || [],
              connectedAt: state.connectedAt || null,
              lastMessageAt: state.lastMessageAt || null
            });
          }
        } catch (e) {
          console.error('Error parsing gateway state:', key, e);
        }
      }
    }

    // Get workflow subscriptions for this user
    const workflowSubKeys = await redis.keys(`wf:sub:*`);
    const workflowSubs: any[] = [];
    const workflowIds = new Set<string>();
    
    for (const key of workflowSubKeys) {
      const subStr = await redis.get(key);
      if (subStr) {
        try {
          const sub = JSON.parse(subStr);
          if (sub.userId === userId) {
            workflowSubs.push({
              workflowId: sub.workflowId,
              nodeId: sub.nodeId,
              symbols: sub.symbols || [],
              eventTypes: sub.eventTypes || [],
              source: sub.source || 'unknown',
              isActive: true
            });
            if (sub.workflowId) {
              workflowIds.add(sub.workflowId);
            }
          }
        } catch (e) {
          console.error('Error parsing workflow subscription:', key, e);
        }
      }
    }

    // Also check active streaming workflows set and include those not in wf:sub:*
    const activeStreamingWorkflows = await redis.smembers(`user:${userId}:active_streaming_workflows`);
    for (const workflowId of activeStreamingWorkflows) {
      workflowIds.add(workflowId);
      
      // Check if this workflow is already in workflowSubs
      const alreadyIncluded = workflowSubs.some(sub => sub.workflowId === workflowId);
      if (!alreadyIncluded) {
        // Try to get additional info from stream filter
        const filterStr = await redis.get(`workflow:${workflowId}:stream_filter`);
        let source = 'unknown';
        let eventTypes: string[] = [];
        
        if (filterStr) {
          try {
            const filter = JSON.parse(filterStr);
            source = filter.source || 'unknown';
            eventTypes = filter.eventTypes || [];
          } catch (e) { /* ignore parse errors */ }
        }
        
        workflowSubs.push({
          workflowId,
          nodeId: '',
          symbols: [],  // May not have explicit symbols
          eventTypes,
          source,
          isActive: true
        });
      }
    }

    // Fetch workflow names from Supabase
    const workflowNames: Record<string, string> = {};
    if (workflowIds.size > 0) {
      const { data: workflows } = await supabase
        .from('workflows')
        .select('id, name')
        .in('id', Array.from(workflowIds));
      
      if (workflows) {
        for (const wf of workflows) {
          workflowNames[wf.id] = wf.name;
        }
      }
    }

    // Add workflow names to subscriptions
    const workflowsWithNames = workflowSubs.map(sub => ({
      ...sub,
      workflowName: workflowNames[sub.workflowId] || 'Unknown Workflow'
    }));

    // Get user-level symbol subscriptions (from Subscribe nodes - global scope)
    const userSubKeys = await redis.keys(`user:${userId}:subscribed_symbols:*`);
    const userSubscriptions: Record<string, string[]> = {};

    for (const key of userSubKeys) {
      const sourceMatch = key.match(/user:.*:subscribed_symbols:(\w+)/);
      if (sourceMatch) {
        const symbols = await redis.smembers(key);
        if (symbols.length > 0) {
          userSubscriptions[sourceMatch[1]] = symbols;
        }
      }
    }

    // Get workflow-scoped subscriptions (from Subscribe nodes - workflow scope)
    const scopedSubKeys = await redis.keys(`workflow:*:subscribed_symbols:*`);
    const workflowScopedSubscriptions: Array<{
      workflowId: string;
      workflowName?: string;
      source: string;
      symbols: string[];
    }> = [];
    const scopedWorkflowIds = new Set<string>();

    for (const key of scopedSubKeys) {
      // Pattern: workflow:{workflowId}:subscribed_symbols:{source}
      const match = key.match(/workflow:([^:]+):subscribed_symbols:(\w+)/);
      if (match) {
        const [, wfId, source] = match;
        const symbols = await redis.smembers(key);
        if (symbols.length > 0) {
          workflowScopedSubscriptions.push({
            workflowId: wfId,
            source,
            symbols
          });
          scopedWorkflowIds.add(wfId);
        }
      }
    }

    // Fetch workflow names for scoped subscriptions
    if (scopedWorkflowIds.size > 0) {
      const { data: scopedWorkflows } = await supabase
        .from('workflows')
        .select('id, name')
        .in('id', Array.from(scopedWorkflowIds));
      
      if (scopedWorkflows) {
        for (const sub of workflowScopedSubscriptions) {
          const wf = scopedWorkflows.find(w => w.id === sub.workflowId);
          sub.workflowName = wf?.name || 'Unknown Workflow';
        }
      }
    }

    // Calculate stats and build symbol-source map
    const allSymbols = new Set<string>();
    const symbolSourceMap: Record<string, string[]> = {};
    
    sources.forEach(s => s.symbols.forEach((sym: string) => {
      allSymbols.add(sym);
      if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
      if (!symbolSourceMap[sym].includes(s.source)) symbolSourceMap[sym].push(s.source);
    }));
    
    workflowSubs.forEach(w => w.symbols.forEach((sym: string) => {
      allSymbols.add(sym);
      if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
      if (!symbolSourceMap[sym].includes(w.source)) symbolSourceMap[sym].push(w.source);
    }));

    // Add user-level subscriptions to symbol counts
    Object.entries(userSubscriptions).forEach(([source, symbols]) => {
      symbols.forEach(sym => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(source)) symbolSourceMap[sym].push(source);
      });
    });

    // Add workflow-scoped subscriptions to symbol counts
    workflowScopedSubscriptions.forEach(sub => {
      sub.symbols.forEach(sym => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(sub.source)) symbolSourceMap[sym].push(sub.source);
      });
    });

    res.json({
      sources,
      workflows: workflowsWithNames,
      userSubscriptions,  // Global subscriptions from Subscribe nodes
      workflowScopedSubscriptions,  // Workflow-scoped subscriptions from Subscribe nodes
      stats: {
        totalSources: sources.filter(s => s.connected).length,
        totalSymbols: allSymbols.size,
        totalWorkflows: workflowSubs.length,
        connectedSources: sources.filter(s => s.connected).map(s => s.source)
      },
      symbolSourceMap
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch subscription status'
    });
  }
});

// Source mapping is now auto-generated in config/marketSources.ts
// Import: SOURCE_TO_MARKET_SOURCE, getMarketSource

// ============================================
// MARKET DATA SUBSCRIPTION OPERATIONS
// ============================================

/**
 * Subscribe to a market data source via Redis Pub/Sub
 * POST /market/:source/subscribe
 */
router.post('/:source/subscribe', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { source } = req.params;
    const {
      credential_id,
      symbols,
      node_id,
      workflow_id,
      stream_types,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      // Source-specific fields
      feed,           // Alpaca: iex or sip
      environment,    // Binance: testnet or live
      asset_type,     // Binance: spot or futures
      kline_interval, // Binance: 1m, 5m, 15m, etc.
      // Subscription scope - accept both snake_case and camelCase
      subscription_scope,
      subscriptionScope,
      target_workflow_id,
      targetWorkflowId,
    } = req.body;

    // Use camelCase first (frontend convention), fallback to snake_case
    const finalSubscriptionScope = subscriptionScope || subscription_scope || 'global';
    const finalTargetWorkflowId = targetWorkflowId || target_workflow_id;

    if (!credential_id) return res.status(400).json({ error: 'credential_id is required' });
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    const marketSource = getMarketSource(source);
    if (!marketSource) {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    const result = await SubscriptionService.subscribe({
      source: marketSource,
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      credentialId: credential_id,
      symbols,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      streamTypes: stream_types
        ? (typeof stream_types === 'string'
            ? stream_types.split(',').map((s: string) => s.trim())
            : stream_types)
        : undefined,
      feed,
      environment,
      assetType: asset_type,
      klineInterval: kline_interval,
      subscriptionScope: finalSubscriptionScope,
      targetWorkflowId: finalTargetWorkflowId,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.data?.message,
      symbols: result.data?.symbols,
      stream_types: result.data?.streamTypes,
      node_id,
      workflow_id: workflow_id || null,
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Subscription failed',
    });
  }
});

/**
 * Unsubscribe from a market data source via Redis Pub/Sub
 * POST /market/:source/unsubscribe
 */
router.post('/:source/unsubscribe', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { source } = req.params;
    const {
      symbols,
      node_id,
      workflow_id,
      stream_types,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      subscription_scope,  // 'global' or 'workflow' - determines which Redis key to use
    } = req.body;

    const marketSource = getMarketSource(source);
    if (!marketSource) {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    const result = await SubscriptionService.unsubscribe({
      source: marketSource,
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      symbols,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      streamTypes: stream_types
        ? (typeof stream_types === 'string'
            ? stream_types.split(',').map((s: string) => s.trim())
            : stream_types)
        : undefined,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Direct Redis cleanup for immediate effect
    const redis = getRedisCache();
    const resolvedSymbols = Array.isArray(symbols) ? symbols : [];
    
    // Use source as-is (e.g., "binance_stream") to match how market-stream-service stores keys
    // Handle workflow-scoped unsubscription (specific symbols for specific workflow)
    if (subscription_scope === 'workflow' && workflow_id && resolvedSymbols.length > 0) {
      const workflowSubKey = `workflow:${workflow_id}:subscribed_symbols:${source}`;
      for (const sym of resolvedSymbols) {
        await redis.srem(workflowSubKey, sym.toUpperCase());
      }
      console.log(`📤 [Market Route] Removed ${resolvedSymbols.join(', ')} from workflow-scoped key: ${workflowSubKey}`);
    }
    // Handle global symbol unsubscription (user-level)
    else if (resolvedSymbols.length > 0 && !workflow_id) {
      const userSubKey = `user:${userId}:subscribed_symbols:${source}`;
      for (const sym of resolvedSymbols) {
        await redis.srem(userSubKey, sym.toUpperCase());
      }
      console.log(`📤 [Market Route] Removed ${resolvedSymbols.join(', ')} from global key: ${userSubKey}`);
    }
    // Handle full workflow cleanup (when removing entire workflow subscription)
    else if (workflow_id && resolvedSymbols.length === 0) {
      const subKey = `wf:sub:${workflow_id}`;
      await redis.del(subKey);
      await redis.srem(`user:${userId}:active_streaming_workflows`, workflow_id);
      await redis.del(`workflow:${workflow_id}:stream_filter`);
      console.log(`📤 [Market Route] Direct cleanup for workflow ${workflow_id}`);
    }

    res.json({
      success: true,
      message: result.data?.message,
      symbols: result.data?.symbols,
      stream_types: result.data?.streamTypes,
      node_id: node_id ?? null,
      workflow_id: workflow_id || null,
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unsubscribe failed',
    });
  }
});

/**
 * Unsubscribe a workflow by ID (fallback when source is unknown)
 * DELETE /market/workflows/:workflowId/unsubscribe
 */
router.delete('/workflows/:workflowId/unsubscribe', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { workflowId } = req.params;
    const redis = getRedisCache();

    // Look up the subscription to find the source
    const subKey = `wf:sub:${workflowId}`;
    const subStr = await redis.get(subKey);
    
    let source: MarketSource | null = null;
    let symbols: string[] = [];
    let nodeId: string | null = null;

    if (subStr) {
      try {
        const sub = JSON.parse(subStr);
        source = sub.source;
        symbols = sub.symbols || [];
        nodeId = sub.nodeId;
      } catch (e) {
        console.error('Error parsing subscription:', e);
      }
    }

    // Remove workflow from active streaming workflows set
    await redis.srem(`user:${userId}:active_streaming_workflows`, workflowId);
    await redis.del(`workflow:${workflowId}:stream_filter`);

    // Publish unsubscribe message to market-stream-service
    const unsubscribeMessage = {
      action: 'unsubscribe',
      userId,
      workflowId,
      nodeId: nodeId || '',
      symbols,
      source: source || 'streaming_workflow',
    };

    await redis.publish('md:control:unsubscribe', JSON.stringify(unsubscribeMessage));
    
    // Clean up subscription data
    await redis.del(subKey);

    console.log(`📤 [Market Route] Unsubscribed workflow ${workflowId} via DELETE endpoint`);

    res.json({
      success: true,
      message: `Workflow ${workflowId} unsubscribed from market data`,
      source,
      symbols_unsubscribed: symbols.length
    });
  } catch (error) {
    console.error('Workflow unsubscribe error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unsubscribe failed',
    });
  }
});

// ============================================
// STREAMING WORKFLOW REGISTRATION
// ============================================

/**
 * Register a workflow to receive streaming market data
 * POST /market/register-streaming-workflow
 * 
 * This endpoint registers a workflow/node to receive real-time market data
 * from a streaming source (e.g., binance_stream). Used by BinanceStreamData
 * node in "listen" mode.
 */
router.post('/register-streaming-workflow', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      workflow_id,
      node_id,
      source,
      filter_symbols,
      filter_types,
      subscription_mode,
    } = req.body;

    if (!workflow_id) {
      return res.status(400).json({ error: 'workflow_id is required' });
    }
    if (!node_id) {
      return res.status(400).json({ error: 'node_id is required' });
    }

    const redis = getRedisCache();
    const streamSource = source || 'binance_stream';
    const now = new Date().toISOString();

    // Store workflow subscription info
    const subKey = `wf:sub:${workflow_id}:${node_id}`;
    const subscriptionData = {
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      source: streamSource,
      filterSymbols: filter_symbols || [],
      filterTypes: filter_types || [],
      subscriptionMode: subscription_mode || 'workflow',
      registeredAt: now,
      lastActivityAt: now,
    };

    await redis.set(subKey, JSON.stringify(subscriptionData));

    // Add to user's active streaming workflows set
    await redis.sadd(`user:${userId}:active_streaming_workflows`, workflow_id);

    // Store stream filter for this workflow
    const filterData = {
      source: streamSource,
      symbols: filter_symbols || [],
      eventTypes: filter_types || [],
      subscriptionMode: subscription_mode || 'workflow',
    };
    await redis.set(`workflow:${workflow_id}:stream_filter`, JSON.stringify(filterData));

    console.log(`📥 [Market Route] Registered streaming workflow: ${workflow_id}, node: ${node_id}, source: ${streamSource}`);

    res.json({
      success: true,
      message: 'Workflow registered for streaming',
      registration: {
        workflowId: workflow_id,
        nodeId: node_id,
        source: streamSource,
        filterSymbols: filter_symbols || [],
        filterTypes: filter_types || [],
        subscriptionMode: subscription_mode || 'workflow',
      },
    });
  } catch (error) {
    console.error('Error registering streaming workflow:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register streaming workflow',
    });
  }
});

/**
 * Unregister a workflow from receiving streaming market data
 * DELETE /market/unregister-streaming-workflow
 * 
 * This endpoint removes a workflow/node from streaming data subscriptions.
 * Called when a streaming node stops or workflow is deleted.
 */
router.delete('/unregister-streaming-workflow', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { workflow_id, node_id } = req.body;

    if (!workflow_id) {
      return res.status(400).json({ error: 'workflow_id is required' });
    }

    const redis = getRedisCache();

    // Remove specific node subscription if node_id provided
    if (node_id) {
      const subKey = `wf:sub:${workflow_id}:${node_id}`;
      await redis.del(subKey);
      console.log(`📤 [Market Route] Unregistered streaming node: ${workflow_id}:${node_id}`);
    }

    // Check if any other nodes still subscribed for this workflow
    const pattern = `wf:sub:${workflow_id}:*`;
    const remainingKeys = await redis.keys(pattern);

    // If no more subscriptions, clean up workflow-level data
    if (remainingKeys.length === 0) {
      await redis.srem(`user:${userId}:active_streaming_workflows`, workflow_id);
      await redis.del(`workflow:${workflow_id}:stream_filter`);
      console.log(`📤 [Market Route] Fully unregistered streaming workflow: ${workflow_id}`);
    }

    res.json({
      success: true,
      message: node_id 
        ? `Node ${node_id} unregistered from streaming` 
        : `Workflow ${workflow_id} unregistered from streaming`,
      remainingSubscriptions: remainingKeys.length,
    });
  } catch (error) {
    console.error('Error unregistering streaming workflow:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unregister streaming workflow',
    });
  }
});

/**
 * Update activity timestamp for a streaming workflow
 * POST /market/streaming-activity
 * 
 * Called periodically to indicate a streaming workflow is still active.
 * Prevents the cleanup service from removing it.
 */
router.post('/streaming-activity', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { workflow_id, node_id } = req.body;

    if (!workflow_id || !node_id) {
      return res.status(400).json({ error: 'workflow_id and node_id are required' });
    }

    const redis = getRedisCache();
    const subKey = `wf:sub:${workflow_id}:${node_id}`;

    const data = await redis.get(subKey);
    if (!data) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscription = JSON.parse(data);
    subscription.lastActivityAt = new Date().toISOString();
    await redis.set(subKey, JSON.stringify(subscription));

    res.json({
      success: true,
      message: 'Activity updated',
      lastActivityAt: subscription.lastActivityAt,
    });
  } catch (error) {
    console.error('Error updating streaming activity:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update activity',
    });
  }
});

/**
 * Manually trigger cleanup of stale streaming workflows
 * POST /market/cleanup-streaming
 * 
 * Admin endpoint to force cleanup of stale subscriptions.
 */
router.post('/cleanup-streaming', async (req, res) => {
  try {
    const { default: streamingCleanupService } = await import('../services/StreamingCleanupService');
    const result = await streamingCleanupService.runCleanup();

    res.json({
      success: true,
      message: 'Cleanup completed',
      cleaned: result.cleaned,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error('Error running streaming cleanup:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run cleanup',
    });
  }
});

// ============================================
// UNIFIED STREAM EXECUTION ENDPOINT
// ============================================

/**
 * Unified stream node execution endpoint
 * POST /market/execute-stream-node
 * 
 * Single orchestrator for streaming trigger nodes (BinanceStreamData, AlpacaStreamData, etc.)
 * Handles subscription AND listener registration atomically - eliminates race conditions.
 * Frontend makes ONE call; backend owns all broker/source logic.
 */
router.post('/execute-stream-node', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      workflow_id,
      node_id,
      node_type,
      mode = 'listen',
      // Subscribe params
      symbols,
      stream_types,
      credential_id,
      environment,
      asset_type,
      feed,
      kline_interval,
      // Filter params
      filter_symbols,
      filter_types,
      subscription_mode = 'workflow',
    } = req.body as StreamExecutionRequest;

    if (!workflow_id) {
      return res.status(400).json({ error: 'workflow_id is required' });
    }
    if (!node_id) {
      return res.status(400).json({ error: 'node_id is required' });
    }
    if (!node_type) {
      return res.status(400).json({ error: 'node_type is required' });
    }

    const redis = getRedisCache();

    // 1. Backend resolves source from node type (frontend never derives this)
    const source = resolveSourceFromNodeType(node_type);
    if (source === 'unknown') {
      return res.status(400).json({ error: `Unknown node_type: ${node_type}` });
    }

    const marketSource = getMarketSource(source);
    if (!marketSource) {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    console.log(`🚀 [ExecuteStreamNode] Starting for ${node_type} (mode: ${mode}, source: ${source})`);

    // 2. Parse symbols
    const parsedSymbols: string[] = Array.isArray(symbols)
      ? symbols.map((s: string) => s.toUpperCase())
      : typeof symbols === 'string'
        ? symbols.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        : [];

    // 3. If subscribe mode, subscribe first and WAIT for completion
    if (mode === 'subscribe') {
      if (parsedSymbols.length === 0) {
        return res.status(400).json({ error: 'Subscribe mode requires at least one symbol' });
      }

      console.log(`📡 [ExecuteStreamNode] Subscribe mode - subscribing ${parsedSymbols.length} symbols`);

      const subscribeResult = await SubscriptionService.subscribe({
        source: marketSource,
        userId,
        workflowId: workflow_id,
        nodeId: node_id,
        credentialId: credential_id || '',
        symbols: parsedSymbols,
        streamTypes: stream_types,
        feed,
        environment,
        assetType: asset_type,
        klineInterval: kline_interval,
        subscriptionScope: 'workflow',
        targetWorkflowId: workflow_id,
      });

      if (!subscribeResult.success) {
        console.error(`❌ [ExecuteStreamNode] Subscription failed:`, subscribeResult.error);
        return res.status(400).json({
          success: false,
          status: 'error',
          error: subscribeResult.error,
        } as StreamExecutionResponse);
      }

      console.log(`✅ [ExecuteStreamNode] Subscription successful for ${parsedSymbols.length} symbols`);
    }

    // 4. Determine effective filter symbols (for listener registration)
    const effectiveFilterSymbols = filter_symbols?.length 
      ? filter_symbols.map((s: string) => s.toUpperCase())
      : mode === 'subscribe' 
        ? parsedSymbols 
        : [];

    const effectiveFilterTypes = filter_types?.length 
      ? filter_types 
      : stream_types || [];

    // 5. Rate limit check for test listener
    const userCountKey = `${REDIS_KEY_USER_TEST_COUNT_PREFIX}${userId}`;
    const allowed = await redis.eval(
      LUA_INCREMENT_TEST_COUNT,
      1,
      userCountKey,
      String(MAX_TEST_LISTENERS_PER_USER),
      String(TEST_LISTENER_TTL_SECONDS)
    );

    if (allowed === 0) {
      console.warn(`⚠️ [ExecuteStreamNode] User ${userId} exceeded max test listeners (${MAX_TEST_LISTENERS_PER_USER})`);
      return res.status(429).json({
        success: false,
        status: 'error',
        error: `Maximum concurrent test listeners (${MAX_TEST_LISTENERS_PER_USER}) exceeded.`,
      } as StreamExecutionResponse);
    }

    // 6. Create test listener key and store metadata
    const testKey = `stream:test:${workflow_id}:${node_id}`;
    const now = new Date().toISOString();

    const testListenerData = {
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      status: 'listening',
      startedAt: now,
      mode,
      subscriptionMode: subscription_mode,
      source,
      filterSymbols: effectiveFilterSymbols,
      filterTypes: effectiveFilterTypes,
    };

    // Store test listener with TTL (auto-expire)
    await redis.setex(testKey, TEST_LISTENER_TTL_SECONDS, JSON.stringify(testListenerData));

    // Add to active listeners SETs for O(1) lookup
    await redis.sadd(REDIS_KEY_ACTIVE_TEST_LISTENERS, testKey);
    
    // Add to user-specific SET for efficient per-user queries (no pattern scanning)
    const userTestListenersKey = `${REDIS_KEY_USER_TEST_LISTENERS_PREFIX}${userId}`;
    await redis.sadd(userTestListenersKey, testKey);

    console.log(`📝 [ExecuteStreamNode] Stored test listener: ${testKey}`);
    console.log(`   Filter symbols: ${effectiveFilterSymbols.join(', ') || 'NONE'}`);
    console.log(`   Filter types: ${effectiveFilterTypes.join(', ') || 'ALL'}`);

    // 7. Register with MarketDataSubscriber via control message
    // CRITICAL: Include filter_symbols so MarketControlHandler subscribes to correct Redis channels
    const controlMessage = {
      action: 'register_workflow',
      userId,
      workflowId: testKey, // Use testKey as pseudo workflow ID for uniqueness
      nodeId: node_id,
      source,
      filter_symbols: effectiveFilterSymbols, // ✅ Always passed with resolved symbols
      filter_types: effectiveFilterTypes,
      subscriptionMode: subscription_mode,
      isTestListener: true,
    };

    await redis.publish('md:control:register_workflow', JSON.stringify(controlMessage));
    console.log(`📡 [ExecuteStreamNode] Published register_workflow with symbols: ${effectiveFilterSymbols.join(', ')}`);

    // 8. Return success response
    const response: StreamExecutionResponse = {
      success: true,
      status: 'listening',
      source,
      symbols: effectiveFilterSymbols,
      testKey,
      message: `Listening for ${node_type} data`,
    };

    console.log(`✅ [ExecuteStreamNode] Complete - testKey: ${testKey}`);
    res.json(response);
  } catch (error) {
    console.error('Error executing stream node:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to execute stream node',
    } as StreamExecutionResponse);
  }
});

// ============================================
// TEST LISTENING (WEBHOOK-LIKE BEHAVIOR)
// ============================================

/**
 * Start test listening for stream data
 * POST /market/test-listen-stream
 * 
 * Initiates a test listening session like n8n webhooks - waits for first matching data.
 * Returns immediately, client should poll /stream-test-result for data.
 */
router.post('/test-listen-stream', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      workflow_id,
      node_id,
      mode,
      subscription_mode,
      filter_symbols,
      filter_types,
      source,
    } = req.body;

    if (!workflow_id) {
      return res.status(400).json({ error: 'workflow_id is required' });
    }
    if (!node_id) {
      return res.status(400).json({ error: 'node_id is required' });
    }

    const redis = getRedisCache();
    
    // Rate limit: check user's active test listener count using atomic Lua script
    const userCountKey = `${REDIS_KEY_USER_TEST_COUNT_PREFIX}${userId}`;
    const allowed = await redis.eval(
      LUA_INCREMENT_TEST_COUNT,
      1, // number of keys
      userCountKey,
      String(MAX_TEST_LISTENERS_PER_USER),
      String(TEST_LISTENER_TTL_SECONDS)
    );

    if (allowed === 0) {
      console.warn(`⚠️ [Test Listen] User ${userId} exceeded max test listeners (${MAX_TEST_LISTENERS_PER_USER})`);
      return res.status(429).json({
        error: `Maximum concurrent test listeners (${MAX_TEST_LISTENERS_PER_USER}) exceeded. Please stop existing listeners first.`,
        maxListeners: MAX_TEST_LISTENERS_PER_USER,
      });
    }

    const testKey = `stream:test:${workflow_id}:${node_id}`;
    const now = new Date().toISOString();

    // Get allowed symbols based on mode
    let allowedSymbols: string[];
    
    if (mode === 'subscribe') {
      // SUBSCRIBE MODE (Self-contained): Use provided symbols directly
      // These are the symbols the user just subscribed to in this node - no intersection needed
      allowedSymbols = (filter_symbols || []).map((s: string) => s.toUpperCase());
      console.log(`🔧 [Test Listen] Subscribe mode - using provided symbols directly: ${allowedSymbols.join(', ') || 'NONE'}`);
    } else {
      // LISTEN MODE: Get allowed symbols from existing subscriptions (with intersection)
      allowedSymbols = await getAllowedSymbols(redis, {
        userId,
        workflowId: workflow_id,
        source: source || 'binance_stream',
        subscriptionMode: subscription_mode || 'workflow',
        filterSymbols: filter_symbols,
      });
    }

    const testListenerData = {
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      status: 'listening',
      startedAt: now,
      mode: mode || 'listen',
      subscriptionMode: subscription_mode || 'workflow',
      source: source || 'binance_stream',
      filterSymbols: allowedSymbols.map((s: string) => s.toUpperCase()),
      filterTypes: filter_types || [],
    };

    // Store test listener with TTL (auto-expire)
    await redis.setex(testKey, TEST_LISTENER_TTL_SECONDS, JSON.stringify(testListenerData));
    
    // Add to active listeners SETs for O(1) lookup
    await redis.sadd(REDIS_KEY_ACTIVE_TEST_LISTENERS, testKey);
    
    // Add to user-specific SET for efficient per-user queries (no pattern scanning)
    const userTestListenersKey = `${REDIS_KEY_USER_TEST_LISTENERS_PREFIX}${userId}`;
    await redis.sadd(userTestListenersKey, testKey);

    // Register temporary subscription with MarketDataSubscriber via control message
    // This ensures data flows through ws:user:{userId} channel to reach checkTestListeners
    const controlMessage = {
      action: 'register_workflow',
      userId,
      workflowId: testKey, // Use testKey as pseudo workflow ID for uniqueness
      nodeId: node_id,
      source: source || 'binance_stream',
      filter_symbols: allowedSymbols.map((s: string) => s.toUpperCase()),
      filter_types: filter_types || [],
      subscriptionMode: subscription_mode || 'workflow',
      isTestListener: true, // Mark as temporary test listener
    };
    await redis.publish('md:control:register_workflow', JSON.stringify(controlMessage));

    console.log(`🎯 [Test Listen] Started test listener: ${testKey}`);
    console.log(`   Allowed symbols: ${allowedSymbols.join(', ') || 'ALL'}`);
    console.log(`   Filter types: ${filter_types?.join(', ') || 'ALL'}`);
    console.log(`   Registered with MarketDataSubscriber for data routing`);

    res.json({
      success: true,
      status: 'listening',
      testKey,
      listener: testListenerData,
    });
  } catch (error) {
    console.error('Error starting test listener:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start test listener',
    });
  }
});

/**
 * Stop test listening for stream data
 * POST /market/stop-listen-stream
 * 
 * Manually cancels a test listening session.
 */
router.post('/stop-listen-stream', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { workflow_id, node_id } = req.body;

    if (!workflow_id || !node_id) {
      return res.status(400).json({ error: 'workflow_id and node_id are required' });
    }

    const redis = getRedisCache();
    const testKey = `stream:test:${workflow_id}:${node_id}`;
    const resultKey = `${testKey}:result`;

    // Delete both test listener and any stored result
    await redis.del(testKey);
    await redis.del(resultKey);
    
    // Remove from active listeners SETs
    await redis.srem(REDIS_KEY_ACTIVE_TEST_LISTENERS, testKey);
    
    // Remove from user-specific SET
    const userTestListenersKey = `${REDIS_KEY_USER_TEST_LISTENERS_PREFIX}${userId}`;
    await redis.srem(userTestListenersKey, testKey);
    
    // Decrement user's test listener count
    const userCountKey = `${REDIS_KEY_USER_TEST_COUNT_PREFIX}${userId}`;
    await redis.eval(LUA_DECREMENT_TEST_COUNT, 1, userCountKey);

    // Unregister from MarketDataSubscriber by publishing unsubscribe control message
    const unsubscribeMessage = {
      action: 'unregister_workflow',
      workflowId: testKey, // Same pseudo workflow ID used during registration
      userId,
      isTestListener: true,
    };
    await redis.publish('md:control:unregister_workflow', JSON.stringify(unsubscribeMessage));

    console.log(`🛑 [Test Listen] Stopped test listener: ${testKey}`);

    res.json({
      success: true,
      status: 'stopped',
      message: 'Test listener stopped',
    });
  } catch (error) {
    console.error('Error stopping test listener:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop test listener',
    });
  }
});

/**
 * Get test listening result
 * GET /market/stream-test-result/:workflow_id/:node_id
 * 
 * Polls for the first matching stream event. Returns data if received,
 * or "listening" status if still waiting.
 */
router.get('/stream-test-result/:workflow_id/:node_id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { workflow_id, node_id } = req.params;

    const redis = getRedisCache();
    const testKey = `stream:test:${workflow_id}:${node_id}`;
    const resultKey = `${testKey}:result`;

    // Check if result arrived (WebSocket push already decremented count in checkTestListeners)
    const resultStr = await redis.get(resultKey);
    if (resultStr) {
      const result = JSON.parse(resultStr);
      
      // Clean up result key only - testKey and SET entry already removed by checkTestListeners
      // DO NOT decrement count here - it was already decremented atomically in checkTestListeners
      await redis.del(resultKey);

      console.log(`✅ [Test Listen] Returning cached result for: ${testKey} (recovery poll)`);

      return res.json({
        success: true,
        status: 'data_received',
        data: result,
      });
    }

    // Check if still listening
    const listenerStr = await redis.get(testKey);
    if (listenerStr) {
      const listener = JSON.parse(listenerStr);
      
      return res.json({
        success: true,
        status: 'listening',
        startedAt: listener.startedAt,
        filterSymbols: listener.filterSymbols,
        filterTypes: listener.filterTypes,
      });
    }

    // No listener and no result - expired or never started
    // Ensure count is decremented for expired listeners
    const userCountKey = `${REDIS_KEY_USER_TEST_COUNT_PREFIX}${userId}`;
    await redis.eval(LUA_DECREMENT_TEST_COUNT, 1, userCountKey);
    
    return res.json({
      success: false,
      status: 'expired',
      message: 'Test listener expired or not found',
    });
  } catch (error) {
    console.error('Error getting test result:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get test result',
    });
  }
});

export default router;
