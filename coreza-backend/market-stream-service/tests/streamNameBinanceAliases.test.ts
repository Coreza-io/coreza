import { buildStreamNames, parseStreamName } from '../src/utils/streamName';

describe('Binance stream type aliases', () => {
  it('maps futures UI aliases to Binance-native stream names', () => {
    const streams = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['markPrice', 'liquidation', 'continuous_kline', 'indexPrice', 'compositeIndex'],
      '1m',
    );

    expect(streams).toEqual([
      'btcusdt@markPrice_1m',
      'btcusdt@forceOrder_1m',
      'btcusdt_perpetual@continuous_kline_1m',
      'btcusdt@indexPrice_1m',
      'btcusdt@compositeIndex_1m',
    ]);
  });

  it('supports current and next quarter continuous kline contract types', () => {
    const currentQuarter = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuous_kline'],
      '1m',
      'current_quarter',
    );

    const nextQuarter = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuous_kline'],
      '1m',
      'next_quarter',
    );

    expect(currentQuarter).toEqual(['btcusdt_current_quarter@continuous_kline_1m']);
    expect(nextQuarter).toEqual(['btcusdt_next_quarter@continuous_kline_1m']);
  });

  it('maps continuousKline alias to Binance-native stream naming', () => {
    const streams = buildStreamNames(
      'binance_market',
      ['BTCUSDT'],
      ['continuousKline'],
      '5m',
      'perpetual',
    );

    expect(streams).toEqual(['btcusdt_perpetual@continuous_kline_5m']);
  });

  it("keeps native trading stream names parseable", () => {
    expect(parseStreamName("binance_trading", "ORDER_TRADE_UPDATE")).toEqual({
      symbol: "*",
      streamType: "ORDER_TRADE_UPDATE",
    });
  });
});
