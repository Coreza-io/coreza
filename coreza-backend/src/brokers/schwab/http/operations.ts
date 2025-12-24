import { BrokerOperation } from '../../types';

export const schwabOperations: Record<string, BrokerOperation> = {
  get_account_numbers: {
    method: 'get',
    path: '/accounts/accountNumbers',
    transformResult: (raw: any) => {
      if (!raw || !Array.isArray(raw)) return { accounts: [] };
      return {
        accounts: raw.map((acc: any) => ({
          id: acc.hashValue,
          name: `Account ${acc.accountNumber}`,
          accountNumber: acc.accountNumber,
          hashValue: acc.hashValue,
        })),
      };
    },
  },
  get_account: {
    method: 'get',
    path: (input: any) => {
      const accountHash = input.accountHash || input.account_hash;
      if (!accountHash) throw new Error('accountHash is required. Please select an account.');
      return `/accounts/${accountHash}`;
    },
    makeParams: (input: any) => ({
      fields: input.fields || 'positions',
    }),
  },
  get_positions: {
    method: 'get',
    path: (input: any) => {
      const accountHash = input.accountHash || input.account_hash;
      if (!accountHash) throw new Error('accountHash is required. Please select an account.');
      return `/accounts/${accountHash}`;
    },
    makeParams: () => ({
      fields: 'positions',
    }),
  },
  get_orders: {
    method: 'get',
    path: (input: any) => {
      const accountHash = input.accountHash || input.account_hash;
      if (!accountHash) throw new Error('accountHash is required. Please select an account.');
      return `/accounts/${accountHash}/orders`;
    },
    makeParams: (input: any) => ({
      maxResults: input.limit || 100,
      fromEnteredTime: input.start_date,
      toEnteredTime: input.end_date,
      status: input.status || 'FILLED,CANCELED,REJECTED',
    }),
  },
  place_order: {
    method: 'post',
    path: (input: any) => {
      const accountHash = input.accountHash || input.account_hash;
      if (!accountHash) throw new Error('accountHash is required. Please select an account.');
      return `/accounts/${accountHash}/orders`;
    },
    makeBody: (input: any) => {
      const {
        symbol,
        instruction = 'BUY',
        quantity,
        orderType = 'MARKET',
        price,
        duration = 'DAY',
        session = 'NORMAL',
      } = input;

      if (!symbol) throw new Error('symbol is required for place_order');
      if (!quantity || quantity <= 0) throw new Error('quantity must be greater than 0');

      const orderPayload: any = {
        orderType: orderType.toUpperCase(),
        session: session.toUpperCase(),
        duration: duration.toUpperCase(),
        orderStrategyType: 'SINGLE',
        orderLegCollection: [
          {
            instruction: instruction.toUpperCase(),
            quantity: Number(quantity),
            instrument: {
              symbol: symbol.toUpperCase(),
              assetType: 'EQUITY',
            },
          },
        ],
      };

      if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && price) {
        orderPayload.price = Number(price);
      }

      return orderPayload;
    },
    transformResult: (raw: any) => ({
      success: true,
      message: 'Order placed successfully',
      orderId: raw.orderId || 'Order submitted',
    }),
  },
  cancel_order: {
    method: 'delete',
    path: (input: any) => {
      const accountHash = input.accountHash || input.account_hash;
      if (!accountHash) throw new Error('accountHash is required. Please select an account.');
      if (!input.order_id) throw new Error('order_id is required for cancel_order');
      return `/accounts/${accountHash}/orders/${input.order_id}`;
    },
  },
  get_quotes: {
    method: 'get',
    path: '/quotes',
    makeParams: (input: any) => {
      if (!input.symbols) throw new Error('symbols parameter is required for get_quotes');
      return {
        symbols: input.symbols,
        fields: input.fields || 'quote,fundamental',
        indicative: 'false',
      };
    },
    transformResult: (raw: any) => {
      const quotes = Object.entries(raw).map(([symbol, data]: [string, any]) => ({
        symbol,
        ...(data.quote || {}),
        fundamental: data.fundamental,
        reference: data.reference,
      }));
      return { quotes, count: quotes.length };
    },
  },
  get_price_history: {
    method: 'get',
    path: '/pricehistory',
    makeParams: (input: any) => {
      if (!input.symbol) throw new Error('symbol parameter is required for get_price_history');
      return {
        symbol: input.symbol,
        periodType: input.periodType || 'day',
        period: input.period || '10',
        frequencyType: input.frequencyType || 'minute',
        frequency: input.frequency || '1',
        needExtendedHoursData: input.needExtendedHoursData || 'false',
      };
    },
    transformResult: (raw: any) => ({
      symbol: raw.symbol,
      candles: raw.candles || [],
      empty: raw.empty || false,
    }),
  },
};
