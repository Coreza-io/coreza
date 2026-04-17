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
      'btcusdt_perpetual@continuousKline_1m',
      'btcusdt@indexPrice_1m',
      'btcusdt@compositeIndex_1m',
    ]);
  });

  it('supports current and next quarter continuous kline contract types', () => {
    const currentQuarter = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuousKline'],
      '1m',
      'current_quarter',
    );

    const nextQuarter = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuousKline'],
      '1m',
      'next_quarter',
    );

    expect(currentQuarter).toEqual(['btcusdt_current_quarter@continuousKline_1m']);
    expect(nextQuarter).toEqual(['btcusdt_next_quarter@continuousKline_1m']);
  });

  it('normalizes legacy continuous_kline alias to camelCase stream naming', () => {
    const streams = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuous_kline'],
      '5m',
      'perpetual',
    );

    expect(streams).toEqual(['btcusdt_perpetual@continuousKline_5m']);
  });
});
