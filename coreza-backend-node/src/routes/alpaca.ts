import express from 'express';
import Alpaca from '@alpacahq/alpaca-trade-api';
import { createError } from '../middleware/errorHandler';
import { supabase } from '../config/supabase';

const router = express.Router();

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

export default router;