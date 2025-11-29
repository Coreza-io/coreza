/**
 * ============================================
 * WEBSOCKET ROUTES - REDIS PUB/SUB ARCHITECTURE
 * ============================================
 * All WebSocket operations route through Redis Pub/Sub control channels.
 * MarketControlHandler orchestrates gateway connections and subscriptions.
 */

import express from 'express';
import { WebSocketManager } from '../services/websocketManager';
import { getRedis } from '../config/redis';
import { REDIS_CHANNELS } from '../config/redisChannels';
import { buildStoreKey, parseStoredValue } from '../utils/store';

const router = express.Router();

// ============================================
// REDIS PUB/SUB WEBSOCKET OPERATIONS
// ============================================

/**
 * Subscribe to a market data source via Redis Pub/Sub
 * POST /websocket/:source/subscribe
 */
router.post('/:source/subscribe', async (req, res) => {
  try {
    const { source } = req.params;
    const {
      user_id,
      credential_id,
      symbols,
      node_id,
      workflow_id,
      stream_types,
      symbolSource = 'manual',
      sourceWorkflowId,
      sourceVariable,
    } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (!credential_id) return res.status(400).json({ error: 'credential_id is required' });
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    if (symbolSource === 'store' && (!sourceWorkflowId || !sourceVariable)) {
      return res.status(400).json({
        error: 'sourceWorkflowId and sourceVariable are required when using stored symbols',
      });
    }

    // Resolve symbols from manual entry or stored values
    const resolveSymbols = async (): Promise<string[]> => {
      if (symbolSource === 'store') {
        const redis = getRedis();
        const storeKey = buildStoreKey(user_id, sourceWorkflowId, sourceVariable);
        const storedValue = parseStoredValue(await redis.get(storeKey));

        if (Array.isArray(storedValue)) {
          return storedValue.map((symbol) => String(symbol).trim()).filter(Boolean);
        }

        if (typeof storedValue === 'string') {
          return storedValue
            .split(',')
            .map((symbol) => symbol.trim())
            .filter(Boolean);
        }

        if (storedValue !== null && storedValue !== undefined) {
          const coerced = String(storedValue).trim();
          return coerced ? [coerced] : [];
        }

        return [];
      }

      if (!symbols) return [];

      return typeof symbols === 'string'
        ? symbols.split(',').map((s: string) => s.trim()).filter(Boolean)
        : Array.isArray(symbols)
        ? symbols
        : [];
    };

    const symbolArray = await resolveSymbols();

    if (symbolArray.length === 0) {
      return res.status(400).json({ error: 'At least one symbol is required' });
    }

    // Parse stream types
    const streamTypes = stream_types
      ? (typeof stream_types === 'string' 
          ? stream_types.split(',').map((s: string) => s.trim()) 
          : stream_types)
      : undefined;

    // Publish control message to Redis
    // MarketControlHandler will orchestrate gateway connection and subscription
    const redis = getRedis();
    const controlMessage = {
      action: 'subscribe',
      userId: user_id,
      workflowId: workflow_id,
      nodeId: node_id,
      symbols: symbolArray,
      source,
      credentialId: credential_id,
      eventTypes: streamTypes,
    };

    await redis.publish(
      REDIS_CHANNELS.controlSubscribe,
      JSON.stringify(controlMessage)
    );

    console.log(`📤 [WebSocket Route] Published subscribe control message for ${source}:`, symbolArray);

    res.json({
      success: true,
      message: `Subscription request sent for ${source}: ${symbolArray.join(', ')}`,
      symbols: symbolArray,
      stream_types: streamTypes,
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
 * POST /websocket/:source/unsubscribe
 */
router.post('/:source/unsubscribe', async (req, res) => {
  try {
    const { source } = req.params;
    const {
      user_id,
      symbols,
      node_id,
      workflow_id,
      stream_types,
      symbolSource = 'manual',
      sourceWorkflowId,
      sourceVariable,
    } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    if (symbolSource === 'store' && (!sourceWorkflowId || !sourceVariable)) {
      return res.status(400).json({
        error: 'sourceWorkflowId and sourceVariable are required when using stored symbols',
      });
    }

    const resolveSymbols = async (): Promise<string[]> => {
      if (symbolSource === 'store') {
        const redis = getRedis();
        const storeKey = buildStoreKey(user_id, sourceWorkflowId, sourceVariable);
        const storedValue = parseStoredValue(await redis.get(storeKey));

        if (Array.isArray(storedValue)) {
          return storedValue.map((symbol) => String(symbol).trim()).filter(Boolean);
        }

        if (typeof storedValue === 'string') {
          return storedValue
            .split(',')
            .map((symbol) => symbol.trim())
            .filter(Boolean);
        }

        if (storedValue !== null && storedValue !== undefined) {
          const coerced = String(storedValue).trim();
          return coerced ? [coerced] : [];
        }

        return [];
      }

      if (!symbols) return [];

      return typeof symbols === 'string'
        ? symbols.split(',').map((s: string) => s.trim()).filter(Boolean)
        : Array.isArray(symbols)
        ? symbols
        : [];
    };

    const symbolArray = await resolveSymbols();

    if (symbolArray.length === 0) {
      return res.status(400).json({ error: 'At least one symbol is required' });
    }

    // Parse stream types
    const streamTypes = stream_types
      ? (typeof stream_types === 'string'
          ? stream_types.split(',').map((s: string) => s.trim())
          : stream_types)
      : undefined;

    // Publish control message to Redis
    const redis = getRedis();
    const controlMessage = {
      action: 'unsubscribe',
      userId: user_id,
      workflowId: workflow_id,
      nodeId: node_id,
      symbols: symbolArray,
      source,
      eventTypes: streamTypes,
    };

    await redis.publish(
      REDIS_CHANNELS.controlUnsubscribe,
      JSON.stringify(controlMessage)
    );

    console.log(`📤 [WebSocket Route] Published unsubscribe control message for ${source}:`, symbolArray);

    res.json({
      success: true,
      message: `Unsubscription request sent for ${source}: ${symbolArray.join(', ')}`,
      symbols: symbolArray,
      stream_types: streamTypes,
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


// ============================================
// LEGACY ENDPOINTS (for backward compatibility)
// ============================================

// WebSocket status endpoint for debugging
router.get('/status', (req, res) => {
  try {
    const stats = WebSocketManager.getStats();
    res.json({
      success: true,
      websocket: {
        running: true,
        port: process.env.WEBSOCKET_PORT || 8081,
        ...stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'WebSocket status error'
    });
  }
});

// Send message to user endpoint (for testing)
router.post('/send/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Message type is required' });
    }

    WebSocketManager.sendToUser(userId, { type, payload });
    
    res.json({
      success: true,
      message: `Message sent to user ${userId}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Send message error'
    });
  }
});

// Broadcast message endpoint (for testing)
router.post('/broadcast', (req, res) => {
  try {
    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Message type is required' });
    }

    WebSocketManager.broadcast({ type, payload });
    
    res.json({
      success: true,
      message: 'Message broadcasted to all clients'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Broadcast error'
    });
  }
});

export default router;
