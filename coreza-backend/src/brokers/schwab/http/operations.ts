import { BrokerOperation, toBarSeries } from '../../types';

interface PriceHistoryInput {
  symbol?: unknown;
  periodType?: unknown;
  period?: unknown;
  frequencyType?: unknown;
  frequency?: unknown;
  needExtendedHoursData?: unknown;
  start_date?: unknown;
  startDate?: unknown;
  end_date?: unknown;
  endDate?: unknown;
  start?: unknown;
  end?: unknown;
  interval?: unknown;
}

interface SchwabCandle {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SchwabPriceHistoryResponse {
  symbol?: string;
  candles?: SchwabCandle[];
}

function toEpochMilliseconds(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a valid date or numeric epoch`);
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a valid date or numeric epoch`);
  }

  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (!Number.isFinite(epoch)) throw new Error(`${fieldName} must be a valid date or numeric epoch`);
    return Math.abs(epoch) < 1e12 ? epoch * 1000 : epoch;
  }

  const epoch = Date.parse(trimmed);
  if (!Number.isFinite(epoch)) {
    throw new Error(`${fieldName} must be a valid date or numeric epoch; received "${value}"`);
  }
  return epoch;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function makePriceHistoryParams(input: PriceHistoryInput): Record<string, unknown> {
  if (!input.symbol) throw new Error('symbol parameter is required for get_price_history');

  const startDate = firstPresent(input.start_date, input.startDate, input.start);
  const endDate = firstPresent(input.end_date, input.endDate, input.end);
  const params: Record<string, unknown> = {
    symbol: input.symbol,
    periodType: input.periodType || 'day',
    frequencyType: input.frequencyType || 'minute',
    frequency: input.frequency || '1',
    needExtendedHoursData: input.needExtendedHoursData || 'false',
  };

  if (startDate !== undefined || endDate !== undefined) {
    if (startDate !== undefined) params.startDate = toEpochMilliseconds(startDate, 'startDate');
    if (endDate !== undefined) params.endDate = toEpochMilliseconds(endDate, 'endDate');
  } else {
    params.period = input.period || '10';
  }

  return params;
}

function schwabFrequency(interval: unknown): {
  periodType: string;
  frequencyType: string;
  frequency: string;
} {
  const normalized = String(interval || '1d').trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(m|min|h|d|day|w|week|mo|month)$/);
  if (!match) throw new Error(`Unsupported Schwab candle interval: "${normalized}"`);

  const amount = Number(match[1]);
  const unit = match[2];
  if ((unit === 'm' || unit === 'min') && [1, 5, 10, 15, 30].includes(amount)) {
    return { periodType: 'day', frequencyType: 'minute', frequency: String(amount) };
  }
  if ((unit === 'd' || unit === 'day') && amount === 1) {
    return { periodType: 'year', frequencyType: 'daily', frequency: '1' };
  }
  if ((unit === 'w' || unit === 'week') && amount === 1) {
    return { periodType: 'year', frequencyType: 'weekly', frequency: '1' };
  }
  if ((unit === 'mo' || unit === 'month') && amount === 1) {
    return { periodType: 'year', frequencyType: 'monthly', frequency: '1' };
  }
  throw new Error(`Unsupported Schwab candle interval: "${normalized}"`);
}

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
    transformResult: (raw: any, input: any, response) => {
      const locationHeader = response?.headers?.location ?? response?.headers?.Location;
      const location = Array.isArray(locationHeader)
        ? locationHeader[0]
        : typeof locationHeader === 'string'
          ? locationHeader
          : undefined;
      const orderIdFromLocation = location?.split('/').filter(Boolean).pop();
      const orderId = raw?.orderId || orderIdFromLocation;

      return {
        success: true,
        message: 'Order placed successfully',
        orderId,
        accountHash: input.accountHash || input.account_hash,
        location,
      };
    },
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
    makeParams: makePriceHistoryParams,
    transformResult: (raw: any) => ({
      symbol: raw.symbol,
      candles: raw.candles || [],
      empty: raw.empty || false,
    }),
  },
  get_candle: {
    method: 'get',
    path: '/pricehistory',
    makeParams: (input: PriceHistoryInput) => makePriceHistoryParams({
      ...input,
      ...schwabFrequency(input.interval),
    }),
    transformResult: (raw: SchwabPriceHistoryResponse, input: PriceHistoryInput) => toBarSeries(
      raw.symbol || String(input.symbol),
      String(input.interval || '1d'),
      (raw.candles || []).map((candle) => ({
        time: candle.datetime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })),
    ),
  },
};
