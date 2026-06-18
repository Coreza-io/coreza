import { resolveTradingPublishStreamName } from '../src/config/brokerStreamConfig';

describe('trading publish channel routing', () => {
  it.each([
    ['schwab', 'order_update', 'account_activity'],
    ['dhan', 'order_update', 'order_alert'],
    ['alpaca', 'order_update', 'trade_updates'],
    ['binance', 'ORDER_TRADE_UPDATE', 'ORDER_TRADE_UPDATE'],
    ['binance', 'executionReport', 'executionReport'],
  ])('maps %s %s to md:stream:%s', (source, normalizedType, expectedStream) => {
    expect(resolveTradingPublishStreamName(source, normalizedType)).toBe(
      expectedStream,
    );
  });
});
