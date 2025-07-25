import { RestConfig } from '../RestBrokerService';
import { BrokerInput } from '../types';

export const alpacaConfig: RestConfig = {
  baseUrl: (creds: any) => {
    // Support both paper trading and live trading
    return creds.paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
  },
  
  makeAuthHeaders: (creds: any) => ({
    'APCA-API-KEY-ID': creds.api_key,
    'APCA-API-SECRET-KEY': creds.secret_key,
  }),
  
  ops: {
    get_account: { 
      method: 'get', 
      path: '/v2/account' 
    },
    
    get_positions: { 
      method: 'get', 
      path: '/v2/positions' 
    },
    
    get_orders: { 
      method: 'get', 
      path: '/v2/orders',
      makeParams: () => ({ 
        status: 'all', 
        limit: '100' 
      })
    },
    
    cancel_orders: { 
      method: 'delete', 
      path: '/v2/orders' 
    },
    
    get_candle: {
      method: 'get', 
      path: '/v2/stocks/bars',
      makeParams: (input: BrokerInput) => {
        const { symbol, timeframe = '1Day', start, end, limit = 100, lookback } = input;
        
        if (!symbol) {
          throw new Error('Symbol is required for get_candle operation');
        }

        let startDate = start;
        let endDate = end;

        // Handle lookback logic
        if ((!startDate || !endDate) && lookback) {
          const now = new Date();
          const lookbackNum = Number(lookback);
          const startDateTime = new Date(now);
          
          if (timeframe.endsWith('Min')) {
            startDateTime.setMinutes(now.getMinutes() - lookbackNum);
          } else if (timeframe.endsWith('Hour')) {
            startDateTime.setHours(now.getHours() - lookbackNum);
          } else {
            startDateTime.setDate(now.getDate() - lookbackNum);
          }
          
          startDate = startDate || startDateTime.toISOString();
          endDate = endDate || now.toISOString();
        }

        if (!startDate || !endDate) {
          throw new Error('Either lookback or both start and end must be provided');
        }

        return {
          symbols: symbol,
          timeframe,
          start: startDate,
          end: endDate,
          limit: String(limit)
        };
      }
    },
    
    place_order: {
      method: 'post', 
      path: '/v2/orders',
      makeBody: (input: BrokerInput) => {
        const { symbol, qty, side, type = 'market', time_in_force = 'day' } = input;
        
        if (!symbol || !qty || !side) {
          throw new Error('Symbol, quantity, and side are required for place_order operation');
        }
        
        return {
          symbol,
          qty,
          side,
          type,
          time_in_force
        };
      }
    }
  }
};