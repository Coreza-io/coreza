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

// Helper function to get API credentials
const getApiCredentials = async (userId: string, credentialId: string): Promise<{ api_key: string; secret_key: string }> => {
  try {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('client_json')
      .eq('user_id', userId)
      .eq('name', credentialId)
      .eq('service_type', 'alpaca')
      .single();
      
    if (error) {
      throw createError(`Supabase error: ${error.message}`, 500);
    }
    
    const creds = data?.client_json || {};
    const api_key = creds.api_key;
    const secret_key = creds.secret_key;
    
    if (!api_key || !secret_key) {
      throw createError('API credentials not found.', 400);
    }
    
    return { api_key, secret_key };
  } catch (error: any) {
    if (error.isOperational) {
      throw error;
    }
    throw createError(`Supabase error: ${error.message}`, 500);
  }
};



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

    const credentials = await getApiCredentials(user_id, credential_id);
    const alpaca = new Alpaca({
      key: credentials.api_key,
      secret: credentials.secret_key,
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
      case 'get_candle':
      case 'get_historical_bars':
        const { symbol, interval, lookback } = req.body;
        
        if (!symbol) {
          return res.status(400).json({ error: 'symbol is required for historical bars' });
        }

        const timeframe = interval === '1Min' ? '1Min' : interval === '5Min' ? '5Min' : '1Day';
        const barsCount = parseInt(lookback || '100');
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - Math.max(barsCount, 30)); // Ensure we get enough data

        // Use user credentials for market data
        const marketDataAlpaca = new Alpaca({
          key: credentials.api_key,
          secret: credentials.secret_key,
          paper: true
        });

        try {
          const barsData = await marketDataAlpaca.getBarsV2(symbol, {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            timeframe: timeframe,
            limit: barsCount
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
            candles: candles.slice(-barsCount)
          });
        } catch (apiError: any) {
          if (apiError.message && apiError.message.includes('403')) {
            return res.status(403).json({ 
              error: 'Market data access forbidden. Please verify your Alpaca account has market data permissions.',
              details: 'This usually means your account needs to be upgraded or verified for market data access'
            });
          }
          throw apiError;
        }
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