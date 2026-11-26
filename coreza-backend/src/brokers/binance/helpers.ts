import type { Bar, HistoricalBar, HistoricalCandleAdapter } from '../types';
import { historicalBarTimestamp, normalizeHistoricalBars } from '../../marketData/normalizeCandles';

const KLINE_PAGE_SIZE = 1000;

export const binanceHistoricalCandles: HistoricalCandleAdapter = {
  // The exchange reports the last millisecond inside the candle.
  closeTimeOffsetMs: 1,
  async fetchRange(range, fetchPage) {
    let start = new Date(range.start).getTime();
    const end = new Date(range.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid Binance candle range");

    const endTime = range.end instanceof Date ? range.end.toISOString() : range.end;
    const bars: HistoricalBar[] = [];
    while (start <= end) {
      const startTime = new Date(start).toISOString();
      const page = await fetchPage({
        start: startTime,
        end: endTime,
        interval: range.interval,
        limit: KLINE_PAGE_SIZE,
        parameters: { startTime, endTime },
      });
      bars.push(...page);
      if (page.length < KLINE_PAGE_SIZE) break;

      const latest = normalizeHistoricalBars(page).at(-1);
      if (!latest || historicalBarTimestamp(latest) < start) {
        throw new Error(`Binance historical data pagination stalled for ${range.symbol}`);
      }
      start = historicalBarTimestamp(latest) + 1;
    }
    return bars;
  },
};

export interface BinanceBar {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export function parseBinanceKline(k: any): BinanceBar {
  return {
    openTime: k[0],
    closeTime: k[6],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    quoteVolume: Number(k[7]),
    trades: k[8],
    takerBuyBaseVolume: Number(k[9]),
    takerBuyQuoteVolume: Number(k[10]),
  };
}

export function fromBinanceBar(b: BinanceBar): Bar {
  return {
    time: b.openTime,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    trades: b.trades,
    quoteVolume: b.quoteVolume,
    takerBuyBaseVolume: b.takerBuyBaseVolume,
    takerBuyQuoteVolume: b.takerBuyQuoteVolume,
    closeTime: b.closeTime,
  };
}
