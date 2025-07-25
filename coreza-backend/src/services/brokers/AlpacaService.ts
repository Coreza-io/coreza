import axios from 'axios';
import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput } from './types';

export class AlpacaService extends BaseBrokerService {
  readonly brokerKey = 'alpaca';

  protected handlers = {
    get_account: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      // Use direct API call since we don't have the Alpaca SDK
      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const response = await axios.get(`${baseUrl}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
        }
      });
      return response.data;
    },

    get_positions: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const response = await axios.get(`${baseUrl}/v2/positions`, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
        }
      });
      return response.data;
    },

    get_orders: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const response = await axios.get(`${baseUrl}/v2/orders?status=all&limit=100`, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
        }
      });
      return response.data;
    },

    cancel_orders: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const response = await axios.delete(`${baseUrl}/v2/orders`, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
        }
      });
      return response.data;
    },

    get_candle: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      const { symbol, timeframe = '1Day', start, end, limit = 100 } = input;
      if (!symbol) throw new Error('Symbol is required for get_candle operation');

      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const params = new URLSearchParams({
        symbols: symbol,
        timeframe,
        limit: limit.toString(),
        ...(start && { start }),
        ...(end && { end }),
      });

      const response = await axios.get(`${baseUrl}/v2/stocks/bars?${params}`, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
        }
      });
      return response.data;
    },

    place_order: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      
      const { symbol, qty, side, type = 'market', time_in_force = 'day' } = input;
      if (!symbol || !qty || !side) {
        throw new Error('Symbol, quantity, and side are required for place_order operation');
      }

      const baseUrl = paper_trading ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
      const response = await axios.post(`${baseUrl}/v2/orders`, {
        symbol,
        qty,
        side,
        type,
        time_in_force,
      }, {
        headers: {
          'APCA-API-KEY-ID': api_key,
          'APCA-API-SECRET-KEY': secret_key,
          'Content-Type': 'application/json',
        }
      });
      return response.data;
    },
  };
}