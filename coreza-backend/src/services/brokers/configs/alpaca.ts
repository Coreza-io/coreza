// src/brokers/configs.ts
import { RestConfig } from '../RestBrokerService';
import { BrokerInput } from '../types';

export const alpacaConfig: RestConfig = {
  // 1. Dynamic baseUrl: trading vs market‑data
  baseUrl: (creds: any, input?: BrokerInput) => {
    if (input?.operation === 'get_candle') {
      return input?.asset_type === 'crypto' 
        ? 'https://data.alpaca.markets'
        : 'https://data.alpaca.markets';
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
      path: (input: BrokerInput) => {
        return input.asset_type === 'crypto' 
          ? '/v1beta3/crypto/us/bars'
          : '/v2/stocks/bars';
      },
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

        const params: any = {
          symbols:   symbol,
          timeframe,
          start:     startDate,
          end:       endDate,
          limit:     String(lim)
        };

        // Only add feed parameter for stocks (free IEX data)
        if (input.asset_type !== 'crypto') {
          params.feed = 'iex';
        }

        return params;
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

    // inside src/brokers/configs.ts → alpacaConfig.ops:
    place_order: {
      method: 'post',
      path: '/v2/orders',
      makeBody: (input: BrokerInput) => {
        const {
          symbol,
          qty,
          notional,
          side,
          type,
          time_in_force,
          limit_price,
          stop_price,
          stop_limit_price,
          trail_percent,
          trail_price
        } = input;

        // Required base fields
        if (!symbol) {
          throw new Error('Symbol and side are required for place_order');
        }
        if (!qty && !notional) {
          throw new Error('Either qty or notional must be provided');
        }

        const body: any = {
          symbol,
          side,
          type,            // market | limit | stop | stop_limit
          time_in_force    // day | gtc | fok | ioc
        };

        // Attach price fields based on order type
        if (type === 'limit') {
          if (!limit_price) {
            throw new Error('Limit orders require a limit_price');
          }
          body.limit_price = String(limit_price);
        } else if (type === 'stop') {
          if (!stop_price) {
            throw new Error('Stop orders require a stop_price');
          }
          body.stop_price = String(stop_price);
        } else if (type === 'stop_limit') {
          if (!stop_price || !stop_limit_price) {
            throw new Error('Stop limit orders require both stop_price and limit_price');
          }
          body.stop_price  = String(stop_price);
          body.limit_price = String(stop_limit_price);
        }
        else if (type === 'trailing_stop') {
          if (!trail_percent && !trail_price) {
            throw new Error('Either trail percent or trail price must be provided');
          }

          if (trail_percent) {
            body.trail_percent = String(trail_percent);
          } else {
            body.trail_price = String(trail_price);
          }
          
        }
        // market orders need no extra price fields

        // Quantity vs Notional (both supported)
        if (notional) {
          body.notional = String(notional);
        } else {
          body.qty = String(qty);
        }

        return body;
      }
    }
  }
};
