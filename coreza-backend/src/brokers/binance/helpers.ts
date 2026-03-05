import type { Bar } from '../types';

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
