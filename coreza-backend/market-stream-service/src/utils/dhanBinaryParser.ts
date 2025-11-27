/**
 * Dhan Binary WebSocket Packet Parser
 * 
 * Dhan uses a binary protocol for WebSocket market data
 * Packet structure varies by packet type (ticker, quote, full)
 */

export interface DhanMarketData {
  type: 'ticker' | 'quote' | 'full';
  SecurityId: string;
  TradingSymbol?: string;
  LTP: number;
  LTQ?: number;
  LTT?: number;
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
  PrevOI?: number;
  ExchangeSegment?: string;
}

// Exchange segment codes
const EXCHANGE_SEGMENTS: Record<number, string> = {
  0: 'IDX',
  1: 'NSE_EQ',
  2: 'NSE_FNO',
  3: 'NSE_CURR',
  4: 'BSE_EQ',
  5: 'MCX',
  6: 'BSE_CURR',
  7: 'BSE_FNO',
};

/**
 * Parse Dhan binary WebSocket packet
 * Returns array of parsed market data messages
 */
export function parseDhanBinaryPacket(buffer: Buffer): DhanMarketData[] {
  try {
    if (buffer.length < 4) {
      console.warn('[Dhan Parser] Buffer too small:', buffer.length);
      return [];
    }

    // First 2 bytes: Response code (15 = Ticker, 16 = Quote, 17 = Full)
    const responseCode = buffer.readUInt16LE(0);
    
    // Next 2 bytes: Number of instruments in packet
    const instrumentCount = buffer.readUInt16LE(2);
    
    let offset = 4;
    const messages: DhanMarketData[] = [];
    
    for (let i = 0; i < instrumentCount; i++) {
      if (offset + 4 > buffer.length) break;
      
      // Exchange segment (1 byte)
      const exchangeSegment = buffer.readUInt8(offset);
      offset += 1;
      
      // Security ID (4 bytes)
      const securityId = buffer.readUInt32LE(offset);
      offset += 4;
      
      let msg: DhanMarketData = {
        type: getPacketType(responseCode),
        SecurityId: securityId.toString(),
        ExchangeSegment: EXCHANGE_SEGMENTS[exchangeSegment] || 'UNKNOWN',
        LTP: 0,
      };
      
      // Parse based on packet type
      switch (responseCode) {
        case 15: // Ticker (minimal data: LTP only)
          if (offset + 4 > buffer.length) break;
          msg.LTP = buffer.readFloatLE(offset);
          offset += 4;
          break;
          
        case 16: // Quote (LTP + Bid/Ask)
          if (offset + 20 > buffer.length) break;
          msg.LTP = buffer.readFloatLE(offset);
          offset += 4;
          msg.BidPrice = buffer.readFloatLE(offset);
          offset += 4;
          msg.BidQty = buffer.readUInt32LE(offset);
          offset += 4;
          msg.AskPrice = buffer.readFloatLE(offset);
          offset += 4;
          msg.AskQty = buffer.readUInt32LE(offset);
          offset += 4;
          break;
          
        case 17: // Full (OHLC + Volume + Depth)
          if (offset + 44 > buffer.length) break;
          msg.LTP = buffer.readFloatLE(offset);
          offset += 4;
          msg.Open = buffer.readFloatLE(offset);
          offset += 4;
          msg.High = buffer.readFloatLE(offset);
          offset += 4;
          msg.Low = buffer.readFloatLE(offset);
          offset += 4;
          msg.Close = buffer.readFloatLE(offset);
          offset += 4;
          msg.Volume = buffer.readUInt32LE(offset);
          offset += 4;
          msg.BidPrice = buffer.readFloatLE(offset);
          offset += 4;
          msg.BidQty = buffer.readUInt32LE(offset);
          offset += 4;
          msg.AskPrice = buffer.readFloatLE(offset);
          offset += 4;
          msg.AskQty = buffer.readUInt32LE(offset);
          offset += 4;
          msg.TotalBuyQty = buffer.readUInt32LE(offset);
          offset += 4;
          break;
          
        default:
          console.warn('[Dhan Parser] Unknown response code:', responseCode);
          continue;
      }
      
      messages.push(msg);
    }
    
    return messages;
  } catch (error) {
    console.error('[Dhan Parser] Parse error:', error);
    return [];
  }
}

function getPacketType(responseCode: number): 'ticker' | 'quote' | 'full' {
  switch (responseCode) {
    case 15: return 'ticker';
    case 16: return 'quote';
    case 17: return 'full';
    default: return 'ticker';
  }
}

/**
 * Encode subscription message to binary format
 */
export function encodeDhanSubscribeMessage(
  symbols: string[],
  exchangeSegment: string = 'NSE_EQ'
): Buffer {
  const segmentCode = getExchangeSegmentCode(exchangeSegment);
  const instrumentCount = symbols.length;
  
  // 4 bytes header + (5 bytes per instrument)
  const buffer = Buffer.allocUnsafe(4 + instrumentCount * 5);
  
  // Request code: 15 for subscribe
  buffer.writeUInt16LE(15, 0);
  // Instrument count
  buffer.writeUInt16LE(instrumentCount, 2);
  
  let offset = 4;
  for (const symbol of symbols) {
    const securityId = parseInt(symbol);
    if (isNaN(securityId)) {
      console.warn('[Dhan] Invalid security ID:', symbol);
      continue;
    }
    
    // Exchange segment (1 byte)
    buffer.writeUInt8(segmentCode, offset);
    offset += 1;
    // Security ID (4 bytes)
    buffer.writeUInt32LE(securityId, offset);
    offset += 4;
  }
  
  return buffer;
}

/**
 * Encode unsubscribe message to binary format
 */
export function encodeDhanUnsubscribeMessage(
  symbols: string[],
  exchangeSegment: string = 'NSE_EQ'
): Buffer {
  const segmentCode = getExchangeSegmentCode(exchangeSegment);
  const instrumentCount = symbols.length;
  
  const buffer = Buffer.allocUnsafe(4 + instrumentCount * 5);
  
  // Request code: 16 for unsubscribe
  buffer.writeUInt16LE(16, 0);
  buffer.writeUInt16LE(instrumentCount, 2);
  
  let offset = 4;
  for (const symbol of symbols) {
    const securityId = parseInt(symbol);
    if (isNaN(securityId)) continue;
    
    buffer.writeUInt8(segmentCode, offset);
    offset += 1;
    buffer.writeUInt32LE(securityId, offset);
    offset += 4;
  }
  
  return buffer;
}

function getExchangeSegmentCode(segment: string): number {
  const entries = Object.entries(EXCHANGE_SEGMENTS);
  for (const [code, name] of entries) {
    if (name === segment) return parseInt(code);
  }
  return 1; // Default to NSE_EQ
}
