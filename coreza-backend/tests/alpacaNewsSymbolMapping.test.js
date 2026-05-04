const {
  buildAlpacaNewsSubscribeMessage,
  buildAlpacaNewsUnsubscribeMessage,
  normalizeAlpacaNewsMessage,
} = require('../src/brokers/alpacaNews/ws/helpers');

describe('alpaca news symbol mapping', () => {
  it('maps slash crypto symbols to Alpaca news subscription format', () => {
    expect(buildAlpacaNewsSubscribeMessage(['BTC/USD', 'AAPL'])).toEqual({
      action: 'subscribe',
      news: ['BTCUSD', 'AAPL'],
    });

    expect(buildAlpacaNewsUnsubscribeMessage(['ETH/USD', 'TSLA'])).toEqual({
      action: 'unsubscribe',
      news: ['ETHUSD', 'TSLA'],
    });
  });

  it('maps Alpaca news crypto symbols back to slash format on inbound messages', () => {
    const event = normalizeAlpacaNewsMessage({
      T: 'n',
      created_at: '2026-01-01T00:00:00Z',
      headline: 'h',
      summary: 's',
      author: 'a',
      url: 'u',
      source: 'test',
      assetType: 'crypto',
      symbols: ['BTCUSD', 'AAPL'],
    });

    expect(event.symbol).toBe('BTC/USD');
    expect(event.symbols).toEqual(['BTC/USD', 'AAPL']);
  });

  it('keeps stock symbols unchanged when assetType is stock', () => {
    const event = normalizeAlpacaNewsMessage({
      T: 'n',
      created_at: '2026-01-01T00:00:00Z',
      source: 'test',
      assetType: 'stock',
      symbols: ['AAPL'],
    });

    expect(event.symbol).toBe('AAPL');
    expect(event.symbols).toEqual(['AAPL']);
  });
});
