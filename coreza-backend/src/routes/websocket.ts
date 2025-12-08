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

/**
 * ============================================
 * WEBSOCKET ROUTES - REDIS PUB/SUB ARCHITECTURE
 * ============================================
 * All WebSocket operations route through SubscriptionService.
 * MarketControlHandler orchestrates gateway connections and subscriptions.
 */

import express from 'express';
import { WebSocketManager } from '../services/websocketManager';
import { SubscriptionService } from '../services/SubscriptionService';
import { MarketSource } from '../types/marketEvent';

const router = express.Router();

// Map route source param to MarketSource type
const sourceToMarketSource: Record<string, MarketSource> = {
  alpaca_stream: 'alpaca',
  binance_stream: 'binance',
  dhan_stream: 'dhan',
  schwab_stream: 'schwab',
};

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
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      // Source-specific fields
      feed,           // Alpaca: iex or sip
      environment,    // Binance: testnet or live
      asset_type,     // Binance: spot or futures
      kline_interval, // Binance: 1m, 5m, 15m, etc.
    } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (!credential_id) return res.status(400).json({ error: 'credential_id is required' });
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    const marketSource = sourceToMarketSource[source];
    if (!marketSource) {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    const result = await SubscriptionService.subscribe({
      source: marketSource,
      userId: user_id,
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
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
    } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const marketSource = sourceToMarketSource[source];
    if (!marketSource) {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    const result = await SubscriptionService.unsubscribe({
      source: marketSource,
      userId: user_id,
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
