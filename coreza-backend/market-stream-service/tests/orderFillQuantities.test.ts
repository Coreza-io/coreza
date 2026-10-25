// Normalization is pure; these dependencies serve connection/authentication paths.
jest.mock('../src/utils/logger', () => ({ createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }) }));
jest.mock('../src/utils/oauthTokenManager', () => ({ refreshOAuthTokenIfNeeded: jest.fn() }));
jest.mock('../src/utils/schwabStreamingSetup', () => ({ buildSchwabLoginMessage: jest.fn(), fetchSchwabStreamingConfig: jest.fn(), parseSchwabStreamingMessage: jest.fn() }));
jest.mock('../src/utils/binanceTimeSync', () => ({ getBinanceTimestamp: jest.fn() }));

import { normalizeAlpacaMessage } from '../src/marketGateways/alpaca/helpers';
import { normalizeBinanceMessage } from '../src/marketGateways/binance/helpers';
import { normalizeDhanMessage } from '../src/marketGateways/dhan/helpers';
import { normalizeSchwabAccountActivityMessage } from '../src/marketGateways/schwab/helpers';

const alpaca = (qty: unknown, total: unknown) => normalizeAlpacaMessage({
  stream: 'trade_updates',
  data: { event: 'partial_fill', qty, price: '2322', order: {
    id: 'order-1', symbol: 'ETH/USD', qty: '0.9978', filled_qty: total,
    filled_avg_price: '2321.7125',
  } },
}, 'alpaca_trading');

const schwab = (detail: Record<string, unknown>) => normalizeSchwabAccountActivityMessage({
  service: 'ACCT_ACTIVITY', content: [{ '2': 'OrderFillCompleted', '3': {
    SchwabOrderID: 'order-1', BaseEvent: { EventType: 'OrderFillCompleted',
      OrderFillCompletedEventOrderLegQuantityInfo: { Symbol: 'AAPL', ...detail },
    },
  } }],
});

describe('individual and cumulative stream fill quantities', () => {
  it('keeps Alpaca event quantity separate from the order total and preserves raw data', () => {
    const event = alpaca('0.215358275', '0.43071655');
    expect(event).toMatchObject({ filledQty: 0.215358275, cumulativeFilledQty: 0.43071655,
      requestedQty: 0.9978, lastFilledPrice: 2322, filledAvgPrice: 2321.7125 });
    expect(event?.rawOrderData?.qty).toBe('0.215358275');
    expect(event?.rawOrderData?.order.filled_qty).toBe('0.43071655');
  });

  it('does not substitute an Alpaca cumulative total for an absent execution quantity', () => {
    expect(alpaca(undefined, '0.4')?.filledQty).toBeUndefined();
    expect(alpaca('0', '0')?.filledQty).toBe(0);
    expect(alpaca('0', '0')?.cumulativeFilledQty).toBe(0);
    expect(alpaca('', 'NaN')?.filledQty).toBeUndefined();
    expect(alpaca('', 'NaN')?.cumulativeFilledQty).toBeUndefined();
    expect(JSON.parse(JSON.stringify(alpaca(undefined, '0.4')))).not.toHaveProperty('filledQty');
  });

  it('exposes successive Alpaca fills without accumulating in the normalizer', () => {
    const events = [alpaca('0.3', '0.3'), alpaca('0.2', '0.5'), alpaca('0.5', '1')];
    expect(events.map(e => e?.filledQty)).toEqual([0.3, 0.2, 0.5]);
    expect(events.map(e => e?.cumulativeFilledQty)).toEqual([0.3, 0.5, 1]);
  });

  it.each(['executionReport', 'ORDER_TRADE_UPDATE'])('separates Binance %s last quantity and total', e => {
    const order = { s: 'BTCUSDT', l: '0.2', z: '0.5', Z: '50', q: '1', X: 'PARTIALLY_FILLED' };
    const msg = e === 'executionReport' ? { e, ...order } : { e, o: order };
    expect(normalizeBinanceMessage(msg, 'binance_trading')).toMatchObject({
      filledQty: 0.2, cumulativeFilledQty: 0.5,
    });
    const missing = e === 'executionReport' ? { e, z: '0.5' } : { e, o: { z: '0.5' } };
    expect(normalizeBinanceMessage(missing, 'binance_trading')?.filledQty).toBeUndefined();
    const zero = { ...order, l: '0', z: '0' };
    expect(normalizeBinanceMessage(e === 'executionReport' ? { e, ...zero } : { e, o: zero }, 'binance_trading'))
      .toMatchObject({ filledQty: 0, cumulativeFilledQty: 0 });
  });

  it('exposes Binance algo executed quantity only as a total', () => {
    const event = normalizeBinanceMessage({ e: 'ALGO_UPDATE', o: { s: 'BTCUSDT', X: 'FINISHED', aq: '0.5' } }, 'binance_trading');
    expect(event?.cumulativeFilledQty).toBe(0.5);
    expect(event?.filledQty).toBeUndefined();
  });

  it('keeps Dhan order-alert totals without inventing an individual execution', () => {
    const event = normalizeDhanMessage({ Type: 'order_alert', Data: {
      OrderNo: 'dhan-1', Symbol: 'RELIANCE', Quantity: 10, TradedQty: 4, RemainingQuantity: 6,
    } }, 'dhan_trading');
    expect(event?.cumulativeFilledQty).toBe(4);
    expect(event?.filledQty).toBeUndefined();
  });

  it('separates Schwab native execution and cumulative decimals', () => {
    const event = schwab({ ExecutionQuantity: { lo: 2000000, signScale: 12 },
      CumulativeQuantity: { lo: 5000000, signScale: 12 } });
    expect(event).toMatchObject({ filledQty: 2, cumulativeFilledQty: 5 });
  });

  it('does not swap Schwab cumulative and individual quantities when either is missing', () => {
    expect(schwab({ CumulativeQuantity: { lo: 5000000, signScale: 12 } })?.filledQty).toBeUndefined();
    expect(schwab({ ExecutionQuantity: { lo: 2000000, signScale: 12 } })?.cumulativeFilledQty).toBeUndefined();
    expect(schwab({ ExecutionQuantity: 0, CumulativeQuantity: 0 })).toMatchObject({ filledQty: 0, cumulativeFilledQty: 0 });
  });
});
