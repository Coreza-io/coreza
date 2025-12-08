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
import { DataService } from '../services/data';
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
// MARKET DATA SUBSCRIPTION OPERATIONS
// ============================================

/**
 * Subscribe to a market data source via Redis Pub/Sub
 * POST /market/:source/subscribe
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
 * POST /market/:source/unsubscribe
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
// MARKET DATA OPERATIONS
// ============================================

// Get candle data from Yahoo Finance
router.post('/get-candle', async (req, res) => {
  try {
    const { ticker, interval = '1d', lookback = 100 } = req.body;

    if (!ticker) {
      return res.status(400).json({ error: 'Ticker symbol is required' });
    }

    const result = await DataService.execute('market', 'get_candle', {
      ticker,
      interval,
      lookback
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    console.error('Market data API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch market data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;