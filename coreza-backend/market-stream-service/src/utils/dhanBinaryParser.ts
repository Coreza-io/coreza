/**
 * Dhan Binary WebSocket Packet Parser
 *
 * DhanHQ v2 market feed sends JSON requests and binary responses. Each binary
 * WebSocket frame can contain one or more concatenated packets with an 8-byte
 * header followed by a response-code-specific payload.
 */

export interface DhanDepthLevel {
  BidQty: number;
  AskQty: number;
  BidOrders: number;
  AskOrders: number;
  BidPrice: number;
  AskPrice: number;
}

export interface DhanMarketData {
  type: 'ticker' | 'quote' | 'full' | 'index' | 'oi' | 'prev_close' | 'market_status';
  SecurityId: string;
  TradingSymbol?: string;
  LTP?: number;
  LTQ?: number;
  LTT?: number;
  ATP?: number;
  BidPrice?: number;
  BidQty?: number;
  AskPrice?: number;
  AskQty?: number;
  Open?: number;
  High?: number;
  Low?: number;
  Close?: number;
  Volume?: number;
  TotalBuyQty?: number;
  TotalSellQty?: number;
  OI?: number;
  HighOI?: number;
  LowOI?: number;
  PrevOI?: number;
  MarketStatus?: string;
  ExchangeSegment?: string;
  Depth?: DhanDepthLevel[];
}

const HEADER_LENGTH = 8;
const DEPTH_LEVEL_LENGTH = 20;
const DEPTH_LEVEL_COUNT = 5;

const RESPONSE_CODES = {
  INDEX: 1,
  TICKER: 2,
  QUOTE: 4,
  OI: 5,
  PREV_CLOSE: 6,
  MARKET_STATUS: 7,
  FULL: 8,
  DISCONNECT: 50,
} as const;

const EXCHANGE_SEGMENTS: Record<number, string> = {
  0: 'IDX_I',
  1: 'NSE_EQ',
  2: 'NSE_FNO',
  3: 'NSE_CURRENCY',
  4: 'BSE_EQ',
  5: 'MCX_COMM',
  7: 'BSE_CURRENCY',
  8: 'BSE_FNO',
};

function hasBytes(buffer: Buffer, offset: number, length: number): boolean {
  return offset + length <= buffer.length;
}

function readQuoteFields(buffer: Buffer, offset: number): Omit<DhanMarketData, 'type' | 'SecurityId' | 'ExchangeSegment'> | null {
  if (!hasBytes(buffer, offset, 42)) return null;

  return {
    LTP: buffer.readFloatLE(offset),
    LTQ: buffer.readInt16LE(offset + 4),
    LTT: buffer.readInt32LE(offset + 6),
    ATP: buffer.readFloatLE(offset + 10),
    Volume: buffer.readInt32LE(offset + 14),
    TotalSellQty: buffer.readInt32LE(offset + 18),
    TotalBuyQty: buffer.readInt32LE(offset + 22),
    Open: buffer.readFloatLE(offset + 26),
    Close: buffer.readFloatLE(offset + 30),
    High: buffer.readFloatLE(offset + 34),
    Low: buffer.readFloatLE(offset + 38),
  };
}

function readDepth(buffer: Buffer, offset: number): DhanDepthLevel[] {
  const depth: DhanDepthLevel[] = [];

  for (let level = 0; level < DEPTH_LEVEL_COUNT; level += 1) {
    const levelOffset = offset + level * DEPTH_LEVEL_LENGTH;
    if (!hasBytes(buffer, levelOffset, DEPTH_LEVEL_LENGTH)) break;

    depth.push({
      BidQty: buffer.readInt32LE(levelOffset),
      AskQty: buffer.readInt32LE(levelOffset + 4),
      BidOrders: buffer.readInt16LE(levelOffset + 8),
      AskOrders: buffer.readInt16LE(levelOffset + 10),
      BidPrice: buffer.readFloatLE(levelOffset + 12),
      AskPrice: buffer.readFloatLE(levelOffset + 16),
    });
  }

  return depth;
}

function parsePayload(
  responseCode: number,
  payload: Buffer,
  securityId: string,
  exchangeSegment: string,
): DhanMarketData | null {
  const base = { SecurityId: securityId, ExchangeSegment: exchangeSegment };

  switch (responseCode) {
    case RESPONSE_CODES.INDEX:
      if (!hasBytes(payload, 0, 4)) return null;
      return { ...base, type: 'index', LTP: payload.readFloatLE(0) };

    case RESPONSE_CODES.TICKER:
      if (!hasBytes(payload, 0, 8)) return null;
      return {
        ...base,
        type: 'ticker',
        LTP: payload.readFloatLE(0),
        LTT: payload.readInt32LE(4),
      };

    case RESPONSE_CODES.QUOTE: {
      const quote = readQuoteFields(payload, 0);
      return quote ? { ...base, type: 'quote', ...quote } : null;
    }

    case RESPONSE_CODES.OI:
      if (!hasBytes(payload, 0, 4)) return null;
      return { ...base, type: 'oi', OI: payload.readInt32LE(0) };

    case RESPONSE_CODES.PREV_CLOSE:
      if (!hasBytes(payload, 0, 8)) return null;
      return {
        ...base,
        type: 'prev_close',
        Close: payload.readFloatLE(0),
        PrevOI: payload.readInt32LE(4),
      };

    case RESPONSE_CODES.MARKET_STATUS:
      if (!hasBytes(payload, 0, 1)) return null;
      return {
        ...base,
        type: 'market_status',
        MarketStatus: String(payload.readUInt8(0)),
      };

    case RESPONSE_CODES.FULL: {
      if (!hasBytes(payload, 0, 154)) return null;
      const quote = readQuoteFields(payload, 0);
      if (!quote) return null;
      const depth = readDepth(payload, 54);
      return {
        ...base,
        type: 'full',
        ...quote,
        OI: payload.readInt32LE(26),
        HighOI: payload.readInt32LE(30),
        LowOI: payload.readInt32LE(34),
        Open: payload.readFloatLE(38),
        Close: payload.readFloatLE(42),
        High: payload.readFloatLE(46),
        Low: payload.readFloatLE(50),
        Depth: depth,
        BidQty: depth[0]?.BidQty,
        AskQty: depth[0]?.AskQty,
        BidPrice: depth[0]?.BidPrice,
        AskPrice: depth[0]?.AskPrice,
      };
    }

    case RESPONSE_CODES.DISCONNECT:
      if (hasBytes(payload, 0, 2)) {
        console.warn('[Dhan Parser] Feed disconnect reason code:', payload.readInt16LE(0));
      }
      return null;

    default:
      console.warn('[Dhan Parser] Unknown response code:', responseCode);
      return null;
  }
}

/**
 * Parse Dhan binary WebSocket frame.
 * Returns normalized records keyed by SecurityId for downstream routing.
 */
export function parseDhanBinaryPacket(buffer: Buffer): DhanMarketData[] {
  try {
    if (buffer.length < HEADER_LENGTH) {
      console.warn('[Dhan Parser] Buffer too small:', buffer.length);
      return [];
    }

    const messages: DhanMarketData[] = [];
    let offset = 0;

    while (offset + HEADER_LENGTH <= buffer.length) {
      const responseCode = buffer.readUInt8(offset);
      const messageLength = buffer.readInt16LE(offset + 1);
      const exchangeSegmentCode = buffer.readUInt8(offset + 3);
      const securityId = buffer.readInt32LE(offset + 4).toString();

      if (messageLength < HEADER_LENGTH) {
        console.warn('[Dhan Parser] Invalid packet length:', messageLength);
        break;
      }

      const nextOffset = offset + messageLength;
      if (nextOffset > buffer.length) {
        console.warn('[Dhan Parser] Incomplete packet:', {
          responseCode,
          messageLength,
          remainingBytes: buffer.length - offset,
        });
        break;
      }

      const payload = buffer.subarray(offset + HEADER_LENGTH, nextOffset);
      const parsed = parsePayload(
        responseCode,
        payload,
        securityId,
        EXCHANGE_SEGMENTS[exchangeSegmentCode] || 'UNKNOWN',
      );

      if (parsed) messages.push(parsed);
      offset = nextOffset;
    }

    return messages;
  } catch (error) {
    console.error('[Dhan Parser] Parse error:', error);
    return [];
  }
}
