import { v4 as uuidv4 } from 'uuid';
import { lookupSecurityId } from './scripMaster';
import { Bar, BarSeriesOutput, toBarSeries } from '../types';


export interface DhanBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function fromDhanBar(b: DhanBar): Bar {
  return {
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  };
}

export async function buildDhanPlaceOrder(input: any, creds: any) {
  const {
    symbol,
    exchange_segment = 'NSE_EQ',
    transactionType = 'BUY',
    orderType = 'MARKET',
    productType = 'CNC',
    validity = 'DAY',
    quantity = 1,
    disclosedQuantity = 0,
    price = '',
    triggerPrice = '',
    afterMarketOrder = false,
    amoTime = '',
    boProfitValue = 0,
    boStopLossValue = 0,
    drvExpiryDate = '',
    drvOptionType = '',
    drvStrikePrice = 0,
  } = input;

  if (!symbol || !quantity || !transactionType) {
    throw new Error('Symbol, quantity, and transactionType are required for place_order');
  }

  const securityId = await lookupSecurityId(symbol, exchange_segment);
  if (!securityId) {
    throw new Error(`Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`);
  }

  if (!creds.client_id) {
    throw new Error('Dhan client_id missing in credentials (required for order)');
  }

  const priceVal = orderType === 'LIMIT' ? String(price || '0') : '';
  const triggerPriceVal = ['STOP_LOSS', 'STOP_LOSS_MARKET', 'SL', 'SLM'].includes(orderType)
    ? String(triggerPrice || '0')
    : '';

  return {
    dhanClientId: creds.client_id,
    correlationId: input._idempotencyKey || uuidv4(),
    transactionType,
    exchangeSegment: exchange_segment,
    productType,
    orderType,
    validity,
    securityId,
    quantity,
    disclosedQuantity,
    price: priceVal,
    triggerPrice: triggerPriceVal,
    afterMarketOrder,
    amoTime,
    boProfitValue,
    boStopLossValue,
    drvExpiryDate,
    drvOptionType,
    drvStrikePrice,
  };
}

export async function buildDhanHistoricalBody(input: any) {
  const {
    symbol,
    exchange_segment = 'NSE_EQ',
    from_date,
    to_date,
    lookback,
    timeframe = '1',
  } = input;

  if (!symbol) throw new Error('Symbol is required for get_candle');

  const securityId = await lookupSecurityId(symbol, exchange_segment);
  if (!securityId) {
    throw new Error(`Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`);
  }

  let startDate = from_date;
  let endDate = to_date;
  const lb = Number(lookback) || 0;

  if ((!startDate || !endDate) && lb > 0) {
    const now = new Date();
    const sd = new Date(now);

    if (timeframe.endsWith('Min')) {
      sd.setMinutes(now.getMinutes() - lb);
    } else if (timeframe.endsWith('Hour')) {
      sd.setHours(now.getHours() - lb);
    } else {
      sd.setDate(now.getDate() - lb);
    }

    startDate = startDate || sd.toISOString();
    endDate = endDate || now.toISOString();
  }

  if (!startDate || !endDate) {
    throw new Error('Either lookback or both from_date and to_date must be provided');
  }

  return {
    securityId,
    exchangeSegment: exchange_segment,
    instrument: 'EQUITY',
    fromDate: startDate,
    toDate: endDate,
    expiryCode: 0,
    oi: false,
  };
}

export function transformDhanCandles(raw: any, input: any): BarSeriesOutput {
  const open = raw.open || [];
  const high = raw.high || [];
  const low = raw.low || [];
  const close = raw.close || [];
  const volume = raw.volume || [];
  const ts = raw.timestamp || [];

  let candles: any[] = [];

  if (Array.isArray(open) && Array.isArray(high) && Array.isArray(low) && Array.isArray(close) && Array.isArray(volume) && Array.isArray(ts)) {
    for (let i = 0; i < open.length; ++i) {
      candles.push({
        t: ts[i],
        o: open[i],
        h: high[i],
        l: low[i],
        c: close[i],
        v: volume[i],
      });
    }
  } else if (Array.isArray(raw.data)) {
    candles = raw.data.map((bar: any) => ({
      t: bar.timestamp || bar.t || bar.T,
      o: bar.open || bar.o || bar.O,
      h: bar.high || bar.h || bar.H,
      l: bar.low || bar.l || bar.L,
      c: bar.close || bar.c || bar.C,
      v: bar.volume || bar.v || bar.V,
    }));
  }

  const dhanBars: DhanBar[] = candles.map((c) => ({
    time: typeof c.t === 'string' ? Date.parse(c.t) : c.t,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    volume: c.v,
  }));

  return toBarSeries(input.symbol, input.timeframe || '1', dhanBars.map(fromDhanBar));
}
