import { parseDhanBinaryPacket } from '../../utils/dhanBinaryParser';
import type { CorezaMarketEvent } from '../../types/marketEvent';

// ============ STREAM NAME PARSING ============
// Dhan stream names are just security IDs (e.g., "1234")
function extractDhanSymbols(streamNames: string[]): string[] {
  return streamNames.map((name) => {
    // If stream name contains metadata separator, extract symbol
    const atIndex = name.indexOf('@');
    return atIndex > 0 ? name.substring(0, atIndex) : name;
  });
}

export function buildDhanSubscribeMessage(streamNames: string[]) {
  const symbols = extractDhanSymbols(streamNames);
  return {
    RequestCode: 15,
    InstrumentCount: symbols.length,
    InstrumentList: symbols.map((s) => ({
      ExchangeSegment: 'NSE_EQ',
      SecurityId: s,
    })),
  };
}

export function buildDhanUnsubscribeMessage(streamNames: string[]) {
  const symbols = extractDhanSymbols(streamNames);
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
