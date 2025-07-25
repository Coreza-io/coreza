import Alpaca from '@alpacahq/alpaca-trade-api';
import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput } from './types';

export class AlpacaService extends BaseBrokerService {
  readonly brokerKey = 'alpaca';

  protected handlers = {
    get_account: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });
      return await client.getAccount();
    },

    get_positions: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });
      return await client.getPositions();
    },

    get_orders: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });
      return await client.getOrders({ status: 'all', limit: 100 });
    },

    cancel_orders: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });
      return await client.cancelAllOrders();
    },

    get_candle: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });

      const { symbol, timeframe = '1Day', start, end, limit = 100 } = input;
      if (!symbol) throw new Error('Symbol is required for get_candle operation');

      return await client.getBarsV2(symbol, {
        timeframe,
        start,
        end,
        limit,
      });
    },

    place_order: async (input: BrokerInput) => {
      const { api_key, secret_key, paper_trading } = await this.getCredentials(input.user_id, input.credential_id);
      const client = new Alpaca({
        credentials: {
          key: api_key,
          secret: secret_key,
        },
        paper: paper_trading || false,
      });

      const { symbol, qty, side, type = 'market', time_in_force = 'day' } = input;
      if (!symbol || !qty || !side) {
        throw new Error('Symbol, quantity, and side are required for place_order operation');
      }

      return await client.createOrder({
        symbol,
        qty,
        side,
        type,
        time_in_force,
      });
    },
  };
}