import express from 'express';
import Alpaca from '@alpacahq/alpaca-trade-api';
import { createError } from '../middleware/errorHandler';
import { supabase } from '../config/supabase';

const router = express.Router();

// Get user credentials list for Alpaca
router.get('/credentials', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const { data, error } = await supabase
      .from('user_credentials')
      .select('id, name, service_type, created_at')
      .eq('user_id', user_id)
      .eq('service_type', 'alpaca');
      
    if (error) {
      console.error('Error fetching credentials:', error);
      return res.status(500).json({ error: 'Failed to fetch credentials' });
    }
    
    res.json({
      success: true,
      credentials: data || []
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to get user credentials
const getUserCredentials = async (userId: string, service: string) => {
  const { data, error } = await supabase
    .from('user_credentials')
    .select('client_json, token_json')
    .eq('user_id', userId)
    .eq('service_type', service)
    .single();
    
  if (error || !data) {
    throw createError('Alpaca credentials not found', 404);
  }
  
  return data;
};

// Get account information
router.get('/account/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const credentials = await getUserCredentials(userId, 'alpaca');
    
    const alpaca = new Alpaca({
      key: credentials.client_json.api_key,
      secret: credentials.client_json.api_secret,
      paper: credentials.client_json.paper || true
    });
    
    const account = await alpaca.getAccount();
    
    res.json({
      account_id: account.id,
      cash: account.cash,
      portfolio_value: account.portfolio_value,
      buying_power: account.buying_power,
      equity: account.equity,
      status: account.status
    });
  } catch (error) {
    next(error);
  }
});

// Get positions
router.get('/positions/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const credentials = await getUserCredentials(userId, 'alpaca');
    
    const alpaca = new Alpaca({
      key: credentials.client_json.api_key,
      secret: credentials.client_json.api_secret,
      paper: credentials.client_json.paper || true
    });
    
    const positions = await alpaca.getPositions();
    
    res.json({
      positions: positions.map(pos => ({
        symbol: pos.symbol,
        qty: pos.qty,
        market_value: pos.market_value,
        cost_basis: pos.cost_basis,
        unrealized_pl: pos.unrealized_pl,
        unrealized_plpc: pos.unrealized_plpc,
        side: pos.side
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Place order
router.post('/orders/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { symbol, qty, side, type = 'market', time_in_force = 'day' } = req.body;
    
    if (!symbol || !qty || !side) {
      throw createError('Symbol, quantity, and side are required', 400);
    }
    
    const credentials = await getUserCredentials(userId, 'alpaca');
    
    const alpaca = new Alpaca({
      key: credentials.client_json.api_key,
      secret: credentials.client_json.api_secret,
      paper: credentials.client_json.paper || true
    });
    
    const order = await alpaca.createOrder({
      symbol,
      qty: parseFloat(qty),
      side,
      type,
      time_in_force
    });
    
    res.json({
      order_id: order.id,
      symbol: order.symbol,
      qty: order.qty,
      side: order.side,
      type: order.type,
      status: order.status,
      submitted_at: order.submitted_at
    });
  } catch (error) {
    next(error);
  }
});

// Get orders
router.get('/orders/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, limit = 50 } = req.query;
    
    const credentials = await getUserCredentials(userId, 'alpaca');
    
    const alpaca = new Alpaca({
      key: credentials.client_json.api_key,
      secret: credentials.client_json.api_secret,
      paper: credentials.client_json.paper || true
    });
    
    const orders = await alpaca.getOrders({
      status: status as string,
      limit: parseInt(limit as string)
    });
    
    res.json({
      orders: orders.map(order => ({
        id: order.id,
        symbol: order.symbol,
        qty: order.qty,
        side: order.side,
        type: order.type,
        status: order.status,
        submitted_at: order.submitted_at,
        filled_at: order.filled_at,
        filled_qty: order.filled_qty
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Get market data
router.get('/bars/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1Day', start, end, limit = 100 } = req.query;
    
    // Create a basic alpaca client for market data (doesn't require user credentials)
    const alpaca = new Alpaca({
      key: process.env.ALPACA_API_KEY || '',
      secret: process.env.ALPACA_API_SECRET || '',
      paper: true
    });
    
    const bars = await alpaca.getBarsV2(symbol, {
      timeframe,
      start: start as string,
      end: end as string,
      limit: parseInt(limit as string)
    });
    
    const barData: any[] = [];
    for await (const bar of bars) {
      barData.push({
        timestamp: bar.Timestamp,
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume
      });
    }
    
    res.json({
      symbol,
      timeframe,
      bars: barData
    });
  } catch (error) {
    next(error);
  }
});

// Add auth-url endpoint for authAction
router.post('/auth-url', async (req, res, next) => {
  try {
    const { user_id, credential_name, api_key, secret_key } = req.body;
    
    if (!user_id || !credential_name || !api_key || !secret_key) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Test the credentials by making a test API call
    try {
      const alpaca = new Alpaca({
        key: api_key,
        secret: secret_key,
        paper: true
      });
      
      const account = await alpaca.getAccount();
      
      if (!account) {
        return res.status(401).json({ error: 'Invalid Alpaca API credentials' });
      }
    } catch (error) {
      return res.status(401).json({ error: 'Invalid Alpaca API credentials' });
    }

    // Save credentials to database
    const { data, error } = await supabase
      .from('user_credentials')
      .upsert({
        user_id,
        name: credential_name,
        service_type: 'alpaca',
        client_json: { api_key, secret_key }
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to save credentials' });
    }

    res.json({
      success: true,
      message: 'Alpaca credentials saved successfully',
      credential_id: data.id
    });
  } catch (error) {
    next(error);
  }
});

// Dynamic operation endpoint to match node pattern
router.post('/:operation', async (req, res, next) => {
  try {
    const { operation } = req.params;
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      return res.status(400).json({ error: 'user_id and credential_id are required' });
    }

    const credentials = await getUserCredentials(user_id, 'alpaca');
    const alpaca = new Alpaca({
      key: credentials.client_json.api_key,
      secret: credentials.client_json.secret_key,
      paper: true
    });

    let result;
    switch (operation) {
      case 'get_account':
        result = await alpaca.getAccount();
        break;
      case 'get_positions':
        result = await alpaca.getPositions();
        break;
      case 'get_orders':
        result = await alpaca.getOrders({
          status: req.body.status || 'all',
          limit: req.body.limit || 500
        });
        break;
      case 'cancel_orders':
        result = await alpaca.cancelAllOrders();
        break;
      case 'get_historical_bars':
        const { symbol, interval, bars } = req.body;
        
        if (!symbol || !interval || !bars) {
          return res.status(400).json({ error: 'symbol, interval, and bars are required for historical bars' });
        }

        const timeframe = interval === '1Min' ? '1Min' : interval === '5Min' ? '5Min' : '1Day';
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - (bars || 100));

        const barsData = await alpaca.getBarsV2(symbol, {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          timeframe: timeframe,
          limit: bars || 100
        });

        const candles = [];
        for await (const bar of barsData) {
          candles.push({
            t: bar.Timestamp,
            o: bar.OpenPrice,
            h: bar.HighPrice,
            l: bar.LowPrice,
            c: bar.ClosePrice,
            v: bar.Volume
          });
        }

        return res.json({
          symbol,
          interval: timeframe,
          candles: candles.slice(-bars)
        });
      case 'place_order':
        const { symbol: orderSymbol, side, qty, type, time_in_force } = req.body;
        
        if (!orderSymbol || !side || !qty || !type || !time_in_force) {
          return res.status(400).json({ error: 'symbol, side, qty, type, and time_in_force are required for placing orders' });
        }

        const orderRequest = {
          symbol: orderSymbol,
          qty: parseInt(qty),
          side: side,
          type: type,
          time_in_force: time_in_force
        };

        result = await alpaca.createOrder(orderRequest);
        break;
      default:
        return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Alpaca operation error:', error);
    next(error);
  }
});

export default router;