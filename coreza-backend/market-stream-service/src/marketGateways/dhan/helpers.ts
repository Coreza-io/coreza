import { parseDhanBinaryPacket } from '../../utils/dhanBinaryParser';
import type { CorezaMarketEvent } from '../../types/marketEvent';

export function buildDhanSubscribeMessage(symbols: string[]) {
  return {
    RequestCode: 15,
    InstrumentCount: symbols.length,
    InstrumentList: symbols.map((s) => ({
      ExchangeSegment: 'NSE_EQ',
      SecurityId: s,
    })),
  };
}

export function buildDhanUnsubscribeMessage(symbols: string[]) {
  return {
    RequestCode: 16,
    InstrumentCount: symbols.length,
    InstrumentList: symbols.map((s) => ({
      ExchangeSegment: 'NSE_EQ',
      SecurityId: s,
    })),
  };
}

export function parseDhanMessage(buffer: Buffer): any[] {
  return parseDhanBinaryPacket(buffer);
}

export function identifyDhanMessageType(msg: any): string {
  return msg.type || 'unknown';
}

export function shouldPublishDhanMessage(msg: any): boolean {
  return ['ticker', 'quote', 'full'].includes(msg.type);
}

export function normalizeDhanMessage(msg: any): CorezaMarketEvent | null {
  if (!msg.SecurityId) return null;
  return {
    source: 'dhan' as const,
    symbol: msg.TradingSymbol || msg.SecurityId,
    type: 'trade' as const,
    t: Date.now(),
    p: msg.LTP,
    b: msg.BidPrice,
    B: msg.BidQty,
    a: msg.AskPrice,
    A: msg.AskQty,
    o: msg.Open,
    h: msg.High,
    l: msg.Low,
    c: msg.Close,
    v: msg.Volume,
  };
}
