import Alpaca from '@alpacahq/alpaca-trade-api';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';

export interface BrokerCredentials {
  api_key: string;
  secret_key?: string;
  client_id?: string;
}

export interface BrokerInput {
  user_id: string;
  credential_id: string;
  operation: string;
  [key: string]: any;
}

export interface BrokerResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Base broker service class
abstract class BaseBrokerService {
  protected abstract serviceName: string;
  
  protected async getCredentials(userId: string, credentialId: string): Promise<any> {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('client_json')
      .eq('user_id', userId)
      .eq('name', credentialId)
      .eq('service_type', this.serviceName)
      .single();
      
    if (error || !data) {
      throw createError(`${this.serviceName} credentials not found`, 404);
    }
    
    return data.client_json;
  }
  
  abstract execute(input: BrokerInput): Promise<BrokerResult>;
}

// Alpaca broker service
class AlpacaService extends BaseBrokerService {
  protected serviceName = 'alpaca';
  
  async execute(input: BrokerInput): Promise<BrokerResult> {
    try {
      const { user_id, credential_id, operation } = input;
      const creds = await this.getCredentials(user_id, credential_id);
      
      if (!creds.api_key || !creds.secret_key) {
        throw createError('Invalid Alpaca API credentials', 400);
      }

      const alpaca = new Alpaca({
        keyId: creds.api_key,
        secretKey: creds.secret_key,
        paper: true,
        baseUrl: "https://paper-api.alpaca.markets",
        dataBaseUrl: "https://data.alpaca.markets"
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
            status: input.status || 'all',
            limit: Number(input.limit) || 500
          });
          break;

        case 'cancel_orders':
          result = await alpaca.cancelAllOrders();
          break;

        case 'get_candle': {
          const { symbol, interval, lookback } = input;
          if (!symbol) {
            throw createError('symbol is required for historical bars', 400);
          }

          const timeframe = interval === '1Min' ? '1Min' : interval === '5Min' ? '5Min' : '1Day';
          const barsCount = Number(lookback) || 100;
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(endDate.getDate() - barsCount);

          const marketDataAlpaca = new Alpaca({
            keyId: creds.api_key,
            secretKey: creds.secret_key,
            paper: true,
            baseUrl: 'https://paper-api.alpaca.markets',
            dataBaseUrl: "https://data.alpaca.markets"
          });

          const barsData = marketDataAlpaca.getBarsV2(symbol, {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            timeframe,
            limit: barsCount,
            feed: 'iex',
          });

          const candles: any[] = [];
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

          result = { symbol, interval: timeframe, candles };
          break;
        }

        case 'place_order': {
          const { symbol, side, qty, type, time_in_force } = input;
          if (!symbol || !side || !qty || !type || !time_in_force) {
            throw createError('symbol, side, qty, type, and time_in_force are required for placing orders', 400);
          }
          const quantity = Number(qty);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw createError('Invalid qty', 400);
          }

          result = await alpaca.createOrder({
            symbol,
            qty: quantity,
            side,
            type,
            time_in_force
          });
          break;
        }

        default:
          throw createError(`Unsupported Alpaca operation: ${operation}`, 400);
      }

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Dhan broker service
class DhanService extends BaseBrokerService {
  protected serviceName = 'dhan';
  private baseUrl = 'https://sandbox.dhan.co/v2';
  private scripMasterUrl = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';
  
  // Cache for scrip master data
  private scripMasterCache: Map<string, string> | null = null;
  private scripMasterCacheTime = 0;
  private cacheDuration = 3600000; // 1 hour
  
  async execute(input: BrokerInput): Promise<BrokerResult> {
    try {
      const { user_id, credential_id, operation } = input;
      const creds = await this.getCredentials(user_id, credential_id);
      
      if (!creds.client_id || !creds.api_key) {
        throw createError('Invalid Dhan API credentials', 400);
      }

      const headers = {
        'access-token': creds.api_key,
        'Accept': 'application/json'
      };

      let result;
      switch (operation) {
        case 'get_account':
          result = await this.makeRequest(`${this.baseUrl}/funds`, { headers });
          break;
        case 'get_positions':
          result = await this.makeRequest(`${this.baseUrl}/positions`, { headers });
          break;
        case 'get_holdings':
          result = await this.makeRequest(`${this.baseUrl}/holdings`, { headers });
          break;
        case 'get_orders':
          result = await this.makeRequest(`${this.baseUrl}/order`, { headers });
          break;
        case 'get_historical_bars':
          result = await this.getHistoricalBars(input, headers);
          break;
        default:
          throw createError(`Unsupported Dhan operation: ${operation}`, 400);
      }

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  private async makeRequest(url: string, options: any): Promise<any> {
    const response = await axios.get(url, { ...options, timeout: 10000 });
    return response.data;
  }
  
  private async getHistoricalBars(input: BrokerInput, headers: any): Promise<any> {
    const { exchange, symbol, interval, lookback } = input;
    
    if (!exchange || !symbol || !interval || !lookback) {
      throw createError('exchange, symbol, interval, and lookback are required for historical bars', 400);
    }

    const securityId = await this.lookupSecurityId(symbol, exchange);
    const isDaily = interval === '1Day';
    const endpoint = isDaily 
      ? `${this.baseUrl}/charts/historical` 
      : `${this.baseUrl}/charts/intraday`;

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

    const response = await axios.post(endpoint, payload, { 
      headers: { ...headers, 'Content-Type': 'application/json' }, 
      timeout: 10000 
    });
    
    let bars = response.data.data || response.data;
    
    // Handle different response formats
    if (typeof bars === 'object' && Array.isArray(bars.open)) {
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
    const candles = bars.map((bar: any) => ({
      t: bar.timestamp || bar.t || bar.T,
      o: bar.open || bar.o || bar.O,
      h: bar.high || bar.h || bar.H,
      l: bar.low || bar.l || bar.L,
      c: bar.close || bar.c || bar.C,
      v: bar.volume || bar.v || bar.V
    }));

    return { symbol, exchange, interval, candles };
  }
  
  private async loadScripMaster(): Promise<Map<string, string>> {
    const now = Date.now();
    
    if (this.scripMasterCache && (now - this.scripMasterCacheTime) < this.cacheDuration) {
      return this.scripMasterCache;
    }

    const response = await axios.get(this.scripMasterUrl, { timeout: 30000 });
    const csvData = response.data;
    
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    const exchIdIndex = headers.indexOf('EXCH_ID');
    const symbolIndex = headers.indexOf('UNDERLYING_SYMBOL');
    const securityIdIndex = headers.indexOf('SECURITY_ID');
    
    if (exchIdIndex === -1 || symbolIndex === -1 || securityIdIndex === -1) {
      throw new Error('Required columns not found in scrip master CSV');
    }

    const master = new Map<string, string>();
    
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      const exchId = columns[exchIdIndex]?.trim();
      const symbol = columns[symbolIndex]?.trim();
      const securityId = columns[securityIdIndex]?.trim();
      
      if (exchId && symbol && securityId) {
        const key = `${exchId}:${symbol.toUpperCase()}`;
        master.set(key, securityId);
      }
    }

    this.scripMasterCache = master;
    this.scripMasterCacheTime = now;
    
    return master;
  }
  
  private async lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
    const master = await this.loadScripMaster();
    const key = `${exchangeSegment}:${symbol.toUpperCase()}`;
    const securityId = master.get(key);
    
    if (!securityId) {
      throw createError(`Security ID not found for ${symbol} on ${exchangeSegment}`, 404);
    }
    
    return securityId;
  }
}

// Main broker service
export class BrokerService {
  private static alpacaService = new AlpacaService();
  private static dhanService = new DhanService();
  
  static async execute(broker: string, input: BrokerInput): Promise<BrokerResult> {
    switch (broker.toLowerCase()) {
      case 'alpaca':
        return this.alpacaService.execute(input);
      case 'dhan':
        return this.dhanService.execute(input);
      default:
        return { success: false, error: `Unsupported broker: ${broker}` };
    }
  }
  
  static async getCredentialsList(broker: string, userId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('id, name, service_type, created_at')
      .eq('user_id', userId)
      .eq('service_type', broker.toLowerCase());
      
    if (error) {
      throw createError('Failed to fetch credentials', 500);
    }
    
    return data || [];
  }
  
  static async saveCredentials(broker: string, userId: string, credentialName: string, credentials: BrokerCredentials): Promise<any> {
    // Test credentials before saving
    const testInput: BrokerInput = {
      user_id: userId,
      credential_id: credentialName,
      operation: broker === 'alpaca' ? 'get_account' : 'get_account'
    };
    
    // Create temporary credentials for testing
    const tempCreds = {
      user_id: userId,
      name: credentialName,
      service_type: broker.toLowerCase(),
      client_json: credentials
    };
    
    // Store temporarily for testing
    await supabase.from('user_credentials').upsert(tempCreds);
    
    try {
      const testResult = await this.execute(broker, testInput);
      if (!testResult.success) {
        throw createError(`Invalid ${broker} credentials: ${testResult.error}`, 401);
      }
    } catch (error) {
      // Remove failed credentials
      await supabase
        .from('user_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('name', credentialName)
        .eq('service_type', broker.toLowerCase());
      throw error;
    }
    
    const { data, error } = await supabase
      .from('user_credentials')
      .select()
      .eq('user_id', userId)
      .eq('name', credentialName)
      .eq('service_type', broker.toLowerCase())
      .single();
    
    if (error) {
      throw createError('Failed to save credentials', 500);
    }
    
    return data;
  }
}