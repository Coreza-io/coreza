import express from 'express';
import { BrokerService } from '../services/brokers';

const router = express.Router();

// Get user credentials list for Dhan
router.get('/credentials', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const credentials = await BrokerService.getCredentialsList('dhan', user_id as string);
    
    res.json({
      success: true,
      credentials
    });
  } catch (error) {
    next(error);
  }
});

// Add auth-url endpoint for authAction
router.post('/auth-url', async (req, res, next) => {
  try {
    const { user_id, credential_name, client_id, api_key } = req.body;
    
    if (!user_id || !credential_name || !client_id || !api_key) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const data = await BrokerService.saveCredentials('dhan', user_id, credential_name, {
      api_key,
      client_id
    });

    res.json({
      success: true,
      message: 'Dhan credentials saved successfully',
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

    const result = await BrokerService.execute('dhan', {
      user_id,
      credential_id,
      operation,
      ...req.body
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;

// Dhan API Configuration
const BASE_URL = 'https://sandbox.dhan.co/v2';
const SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';

// Cache for scrip master data
let scripMasterCache: Map<string, string> | null = null;
let scripMasterCacheTime = 0;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

interface DhanCredentials {
  client_id: string;
  api_key: string;
}

// Helper function to get API credentials
async function getApiCredentials(userId: string, credentialId: string): Promise<DhanCredentials> {
  try {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('client_json')
      .eq('user_id', userId)
      .eq('name', credentialId)
      .eq('service_type', 'dhan')
      .single();

    if (error || !data) {
      throw createError('Dhan credentials not found', 404);
    }

    const creds = data.client_json;
    if (!creds.client_id || !creds.api_key) {
      throw createError('Invalid Dhan API credentials', 400);
    }

    return {
      client_id: creds.client_id,
      api_key: creds.api_key
    };
  } catch (error) {
    throw createError('Failed to retrieve Dhan credentials', 500);
  }
}

// Load scrip master data with caching
async function loadScripMaster(): Promise<Map<string, string>> {
  const now = Date.now();
  
  if (scripMasterCache && (now - scripMasterCacheTime) < CACHE_DURATION) {
    return scripMasterCache;
  }

  try {
    const response = await axios.get(SCRIP_MASTER_URL, { timeout: 30000 });
    const csvData = response.data;
    
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    const exch_id_index = headers.indexOf('EXCH_ID');
    const symbol_index = headers.indexOf('UNDERLYING_SYMBOL');
    const security_id_index = headers.indexOf('SECURITY_ID');
    
    if (exch_id_index === -1 || symbol_index === -1 || security_id_index === -1) {
      throw new Error('Required columns not found in scrip master CSV');
    }

    const master = new Map<string, string>();
    
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      const exch_id = columns[exch_id_index]?.trim();
      const symbol = columns[symbol_index]?.trim();
      const security_id = columns[security_id_index]?.trim();
      
      if (exch_id && symbol && security_id) {
        const key = `${exch_id}:${symbol.toUpperCase()}`;
        master.set(key, security_id);
      }
    }

    scripMasterCache = master;
    scripMasterCacheTime = now;
    
    console.log(`Loaded ${master.size} securities from Dhan scrip master`);
    return master;
  } catch (error) {
    console.error('Failed to load scrip master:', error);
    throw createError('Failed to load Dhan scrip master data', 502);
  }
}

// Lookup security ID for symbol
async function lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
  const master = await loadScripMaster();
  const key = `${exchangeSegment}:${symbol.toUpperCase()}`;
  const securityId = master.get(key);
  
  if (!securityId) {
    throw createError(`Security ID not found for ${symbol} on ${exchangeSegment}`, 404);
  }
  
  return securityId;
}

// Save credentials
router.post('/auth', async (req, res, next) => {
  try {
    const { user_id, credential_name, client_id, api_key } = req.body;
    
    if (!user_id || !credential_name || !client_id || !api_key) {
      throw createError('Missing required parameters', 400);
    }

    // Test the credentials by making a test API call
    const headers = {
      'access-token': api_key,
      'Accept': 'application/json'
    };

    try {
      const testResponse = await axios.get(`${BASE_URL}/funds`, { headers, timeout: 10000 });
      
      if (testResponse.status !== 200) {
        throw createError('Invalid Dhan API credentials', 401);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw createError('Invalid Dhan API credentials', 401);
      }
      throw createError('Failed to validate Dhan credentials', 502);
    }

    // Save credentials to database
    const { data, error } = await supabase
      .from('user_credentials')
      .upsert({
        user_id,
        name: credential_name,
        service_type: 'dhan',
        client_json: { client_id, api_key }
      })
      .select()
      .single();

    if (error) {
      throw createError('Failed to save credentials', 500);
    }

    res.json({
      message: 'Dhan credentials saved successfully',
      credential_id: data.id
    });
  } catch (error) {
    next(error);
  }
});

// Get account funds
router.post('/funds', async (req, res, next) => {
  try {
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json'
    };

    const response = await axios.get(`${BASE_URL}/funds`, { headers, timeout: 10000 });
    
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Get positions
router.post('/positions', async (req, res, next) => {
  try {
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json'
    };

    const response = await axios.get(`${BASE_URL}/positions`, { headers, timeout: 10000 });
    
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Get holdings
router.post('/holdings', async (req, res, next) => {
  try {
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json'
    };

    const response = await axios.get(`${BASE_URL}/holdings`, { headers, timeout: 10000 });
    
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Get orders
router.post('/orders', async (req, res, next) => {
  try {
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json'
    };

    const response = await axios.get(`${BASE_URL}/order`, { headers, timeout: 10000 });
    
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Cancel order
router.post('/orders/cancel', async (req, res, next) => {
  try {
    const { user_id, credential_id, order_id } = req.body;
    
    if (!user_id || !credential_id || !order_id) {
      throw createError('user_id, credential_id, and order_id are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const payload = { orderId: order_id };

    const response = await axios.post(`${BASE_URL}/order/cancel`, payload, { headers, timeout: 10000 });
    
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Get historical/intraday candle data
router.post('/candles', async (req, res, next) => {
  try {
    const { user_id, credential_id, exchange, symbol, interval, lookback } = req.body;
    
    if (!user_id || !credential_id || !exchange || !symbol || !interval || !lookback) {
      throw createError('All parameters are required: user_id, credential_id, exchange, symbol, interval, lookback', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    // Get security ID from scrip master
    const exchangeSegment = exchange.split('_')[0]; // Extract NSE from NSE_EQ
    const securityId = await lookupSecurityId(symbol, exchange);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Determine endpoint and payload based on interval
    const isDaily = interval === '1Day';
    const endpoint = isDaily 
      ? `${BASE_URL}/charts/historical` 
      : `${BASE_URL}/charts/intraday`;

    const payload: any = {
      securityId,
      exchangeSegment: exchange,
      instrument: 'EQUITY',
      expiryCode: 0,
      oi: false
    };

    if (isDaily) {
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setDate(today.getDate() - lookback);
      
      payload.fromDate = fromDate.toISOString().split('T')[0];
      payload.toDate = today.toISOString().split('T')[0];
    }

    const response = await axios.post(endpoint, payload, { headers, timeout: 10000 });
    
    let bars = response.data.data || response.data;
    
    // Handle different response formats
    if (typeof bars === 'object' && Array.isArray(bars.open)) {
      // Format: { open: [...], high: [...], low: [...], close: [...], volume: [...], timestamp: [...] }
      const length = bars.open.length;
      const reconstructed = [];
      
      for (let i = 0; i < length; i++) {
        reconstructed.push({
          timestamp: bars.timestamp[i],
          open: bars.open[i],
          high: bars.high[i],
          low: bars.low[i],
          close: bars.close[i],
          volume: bars.volume[i]
        });
      }
      bars = reconstructed;
    }

    // Limit to lookback for intraday data
    if (!isDaily && Array.isArray(bars)) {
      bars = bars.slice(-lookback);
    }

    // Transform to standardized candle format
    const candles = bars.map((bar: any) => {
      const timestamp = bar.timestamp || bar.t || bar.T;
      const open = bar.open || bar.o || bar.O;
      const high = bar.high || bar.h || bar.H;
      const low = bar.low || bar.l || bar.L;
      const close = bar.close || bar.c || bar.C;
      const volume = bar.volume || bar.v || bar.V;
      
      return {
        t: timestamp,
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume
      };
    });

    res.json({
      symbol,
      exchange,
      interval,
      candles
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

// Get quote data
router.post('/quote', async (req, res, next) => {
  try {
    const { user_id, credential_id, exchange, symbol } = req.body;
    
    if (!user_id || !credential_id || !exchange || !symbol) {
      throw createError('user_id, credential_id, exchange, and symbol are required', 400);
    }

    const creds = await getApiCredentials(user_id, credential_id);
    const securityId = await lookupSecurityId(symbol, exchange);
    
    const headers = {
      'access-token': creds.api_key,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const payload = {
      securityId,
      exchangeSegment: exchange,
      instrument: 'EQUITY'
    };

    const response = await axios.post(`${BASE_URL}/marketfeed/ltp`, payload, { headers, timeout: 10000 });
    
    res.json({
      symbol,
      exchange,
      data: response.data
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`Dhan API error: ${error.response.data}`, error.response.status);
    }
    next(error);
  }
});

export default router;