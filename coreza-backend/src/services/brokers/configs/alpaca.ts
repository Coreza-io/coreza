// src/brokers/configs.ts
import { RestConfig } from '../RestBrokerService';
import { BrokerInput } from '../types';

export const alpacaConfig: RestConfig = {
  // 1. Dynamic baseUrl: trading vs market‑data
  baseUrl: (creds: any, input?: BrokerInput) => {
    if (input?.operation === 'get_candle') {
      return 'https://data.alpaca.markets';
    }
    return creds.paper_trading
      ? 'https://paper-api.alpaca.markets'
      //: 'https://api.alpaca.markets';
      : 'https://paper-api.alpaca.markets';
  },

  // 2. Auth headers remain the same
  makeAuthHeaders: (creds: any) => ({
    'APCA-API-KEY-ID':     creds.api_key,
    'APCA-API-SECRET-KEY': creds.secret_key,
  }),

  // 3. Operation → HTTP mapping
  ops: {
    get_account: {
      method: 'get',
      path:   '/v2/account'
    },

    get_positions: {
      method: 'get',
      path:   '/v2/positions'
    },

    get_orders: {
      method: 'get',
      path:   '/v2/orders',
      makeParams: () => ({
        status: 'all',
        limit:  '100'
      })
    },

    cancel_orders: {
      method: 'delete',
      path:   '/v2/orders'
    },

    get_candle: {
      method: 'get',
      path:   '/v2/stocks/bars',
      makeParams: (input: BrokerInput) => {
        const {
          symbol,
          timeframe = '1Day',
          lookback,
          start:  inputStart,
          end:    inputEnd,
          limit:  inputLimit = 100
        } = input;

        if (!symbol) {
          throw new Error('Symbol is required for get_candle operation');
        }

        // parse lookback/limit
        const lb    = Number(lookback)   || undefined;
        const lim   = Number(inputLimit) || lb || 100;

        // calculate start/end if needed
        let startDate = inputStart;
        let endDate   = inputEnd;
        if ((!startDate || !endDate) && lb) {
          const now = new Date();
          const sd  = new Date(now);

          if      (timeframe.endsWith('Min'))  sd.setMinutes(now.getMinutes() - lb);
          else if (timeframe.endsWith('Hour')) sd.setHours(now.getHours()     - lb);
          else                                  sd.setDate(now.getDate()      - lb);

          startDate = startDate || sd.toISOString();
          endDate   = endDate   || now.toISOString();
        }

        if (!startDate || !endDate) {
          throw new Error('Either lookback or both start and end must be provided');
        }

        return {
          symbols:   symbol,
          timeframe,
          start:     startDate,
          end:       endDate,
          limit:     String(lim),
          feed:      'iex'        // ← only here, for free‑plan IEX data
        };
      },
      transformResult: (raw: any, input: BrokerInput) => {
        // Normalize Alpaca bars response into Candle[]
        const arr = {
          symbol: input.symbol,
          candles: raw.bars?.[input.symbol] ?? []
        };
        return arr;
      }
    },

    place_order: {
      method: 'post',
      path:   '/v2/orders',
      makeBody: (input: BrokerInput) => {
        const {
          symbol,
          qty,
          side,
          type          = 'market',
          time_in_force = 'day'
        } = input;

        if (!symbol || !qty || !side) {
          throw new Error('Symbol, quantity, and side are required for place_order operation');
        }

        return { symbol, qty, side, type, time_in_force };
      }
    }
  }
};
