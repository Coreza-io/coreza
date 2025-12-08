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
import { getRedis } from '../config/redis';
import { REDIS_CHANNELS } from '../config/redisChannels';
import { getStoreValue } from '../utils/store';

const router = express.Router();

// Binance subscribe/unsubscribe to market data streams
router.post('/binance/subscribe', async (req, res) => {
  try {
    const { 
      credential_id, 
      operation = 'subscribe', 
      symbols, 
      stream_types = ['trade'],
      kline_interval = '1m',
      environment = 'testnet',
      asset_type = 'spot',
      symbolSource = 'manual',
      sourceWorkflowId,
      sourceVariable,
      workflow_id,
      node_id,
      user_id 
    } = req.body;

    if (!credential_id) {
      return res.status(400).json({ error: 'credential_id is required' });
    }

    // Resolve symbols based on source
    let resolvedSymbols: string[] = [];
    
    if (symbolSource === 'manual') {
      if (!symbols) {
        return res.status(400).json({ error: 'symbols are required for manual source' });
      }
      resolvedSymbols = typeof symbols === 'string' 
        ? symbols.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        : symbols.map((s: string) => s.toUpperCase());
    } else if (symbolSource === 'store' && sourceWorkflowId && sourceVariable) {
      const storeKey = `workflow:${sourceWorkflowId}:${sourceVariable}`;
      const stored = await getStoreValue(storeKey);
      if (stored) {
        resolvedSymbols = Array.isArray(stored) 
          ? stored.map((s: string) => String(s).toUpperCase())
          : String(stored).split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean);
      }
    }

    if (resolvedSymbols.length === 0) {
      return res.status(400).json({ error: 'No symbols resolved for subscription' });
    }

    // Map stream_types to eventTypes format
    // Binance uses: trade, kline, bookTicker, ticker
    const eventTypes = stream_types.map((type: string) => {
      if (type === 'kline') return `kline_${kline_interval}`;
      return type;
    });

    // Publish control message to market-stream-service
    const redis = getRedis();
    const channel = operation === 'subscribe' 
      ? REDIS_CHANNELS.controlSubscribe 
      : REDIS_CHANNELS.controlUnsubscribe;

    const controlMessage = {
      action: operation,
      userId: user_id,
      workflowId: workflow_id,
      nodeId: node_id,
      symbols: resolvedSymbols,
      source: 'binance_stream',
      credentialId: credential_id,
      eventTypes,
      environment,
      assetType: asset_type,
    };

    await redis.publish(channel, JSON.stringify(controlMessage));

    console.log(`📡 [Market] Published ${operation} control message for Binance:`, {
      symbols: resolvedSymbols,
      eventTypes,
      environment,
      assetType: asset_type,
    });

    res.json({ 
      success: true, 
      message: `${operation === 'subscribe' ? 'Subscribed' : 'Unsubscribed'} ${resolvedSymbols.length} symbols`,
      symbols: resolvedSymbols,
      eventTypes,
    });
  } catch (error) {
    console.error('Binance subscribe error:', error);
    res.status(500).json({ 
      error: 'Failed to process subscription',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

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