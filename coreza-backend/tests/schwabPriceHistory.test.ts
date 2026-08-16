import { schwabConfig } from '../src/brokers/schwab/http/config';
import { schwabOperations } from '../src/brokers/schwab/http/operations';

describe('Schwab price history', () => {
  it('preserves period-mode parameters', () => {
    expect(schwabOperations.get_price_history.makeParams!({
      symbol: 'AAPL',
      periodType: 'month',
      period: '6',
      frequencyType: 'daily',
      frequency: '1',
      needExtendedHoursData: 'true',
    })).toEqual({
      symbol: 'AAPL',
      periodType: 'month',
      period: '6',
      frequencyType: 'daily',
      frequency: '1',
      needExtendedHoursData: 'true',
    });
  });

  it('converts range dates to epoch milliseconds and omits period', () => {
    expect(schwabOperations.get_price_history.makeParams!({
      symbol: 'AAPL',
      period: '10',
      start_date: '2023-01-01',
      endDate: '2023-01-02T00:00:00.000Z',
    })).toEqual({
      symbol: 'AAPL',
      periodType: 'day',
      frequencyType: 'minute',
      frequency: '1',
      needExtendedHoursData: 'false',
      startDate: 1672531200000,
      endDate: 1672617600000,
    });
  });

  it('accepts numeric epoch seconds and milliseconds', () => {
    expect(schwabOperations.get_price_history.makeParams!({
      symbol: 'AAPL',
      startDate: 1672531200,
      end_date: '1672617600000',
    })).toEqual(expect.objectContaining({
      startDate: 1672531200000,
      endDate: 1672617600000,
    }));
  });

  it('rejects an invalid range date with the field name', () => {
    expect(() => schwabOperations.get_price_history.makeParams!({
      symbol: 'AAPL',
      start_date: 'not-a-date',
    })).toThrow('startDate must be a valid date or numeric epoch');
  });

  it('maps get_candle start/end and returns the BarSeries contract', () => {
    const operation = schwabOperations.get_candle;
    expect(operation.makeParams!({
      symbol: 'AAPL',
      interval: '1d',
      start: '2023-01-01',
      end: '2023-01-02',
    })).toEqual(expect.objectContaining({
      startDate: 1672531200000,
      endDate: 1672617600000,
      periodType: 'year',
      frequencyType: 'daily',
      frequency: '1',
    }));

    expect(operation.transformResult!({
      symbol: 'AAPL',
      candles: [{
        datetime: 1672531200000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1234,
      }],
    }, { symbol: 'AAPL', interval: '1d' })).toEqual({
      BarSeries: [{
        symbol: 'AAPL',
        interval: '1d',
        bars: [{
          time: 1672531200000,
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1234,
        }],
      }],
      next_page_token: null,
      has_more: false,
    });
  });

  it('rejects candle intervals unsupported by Schwab', () => {
    expect(() => schwabOperations.get_candle.makeParams!({
      symbol: 'AAPL',
      interval: '1h',
      start: '2023-01-01',
      end: '2023-01-02',
    })).toThrow('Unsupported Schwab candle interval: "1h"');
  });

  it('routes get_candle through Schwab market data', () => {
    expect(schwabConfig.baseUrl instanceof Function && schwabConfig.baseUrl({}, {
      operation: 'get_candle',
    })).toBe('https://api.schwabapi.com/marketdata/v1');
  });
});
