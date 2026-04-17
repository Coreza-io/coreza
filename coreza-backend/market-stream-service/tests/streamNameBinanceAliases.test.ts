import { buildStreamNames } from '../src/utils/streamName';

describe('Binance stream type aliases', () => {
  it('maps futures UI aliases to Binance-native stream names', () => {
    const streams = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['markPrice', 'liquidation', 'continuousKline', 'indexPrice', 'compositeIndex'],
      '1m',
    );

    expect(streams).toEqual([
      'btcusdt@markPrice_1m',
      'btcusdt@forceOrder_1m',
      'btcusdt@continuous_kline_1m',
      'btcusdt@indexPrice_1m',
      'btcusdt@compositeIndex_1m',
    ]);
  });
});
