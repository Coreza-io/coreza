import { parseDhanBinaryPacket } from '../../../utils/dhanBinaryParser';
import {
  getDhanMarketWsUrl,
  getDhanOrderUpdateWsUrl,
  resolveDhanEnvironment,
} from '../environment';
import type { MarketEvent } from '../../../types/marketEvent';

const DHAN_TRADING_SOURCE = 'dhan_trading';
const DHAN_ORDER_ALERT_TYPE = 'order_alert';

type DhanCredentials = {
  api_key?: string;
  access_token?: string;
  client_id?: string;
};

type DhanOrderAlertData = Record<string, unknown>;

type DhanOrderAlertMessage = {
  Type?: string;
  Data?: DhanOrderAlertData;
};

function isDhanTradingSource(source?: string): boolean {
  return source === DHAN_TRADING_SOURCE;
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

type DhanDepthPayload = {
  BidPrice?: unknown;
  BidQty?: unknown;
  AskPrice?: unknown;
  AskQty?: unknown;
};

function normalizeDhanDepth(value: unknown): {
  bids?: Array<{ p: number; q: number }>;
  asks?: Array<{ p: number; q: number }>;
} {
  if (!Array.isArray(value)) return {};

  const bids: Array<{ p: number; q: number }> = [];
  const asks: Array<{ p: number; q: number }> = [];

  for (const level of value) {
    if (!level || typeof level !== 'object') continue;
    const depth = level as DhanDepthPayload;
    const bidPrice = toNumberValue(depth.BidPrice);
    const bidQty = toNumberValue(depth.BidQty);
    const askPrice = toNumberValue(depth.AskPrice);
    const askQty = toNumberValue(depth.AskQty);

    if (
      bidPrice !== undefined &&
      bidQty !== undefined &&
      (bidPrice > 0 || bidQty > 0)
    ) {
      bids.push({ p: bidPrice, q: bidQty });
    }
    if (
      askPrice !== undefined &&
      askQty !== undefined &&
      (askPrice > 0 || askQty > 0)
    ) {
      asks.push({ p: askPrice, q: askQty });
    }
  }

  return {
    ...(bids.length > 0 ? { bids } : {}),
    ...(asks.length > 0 ? { asks } : {}),
  };
}

function normalizeDhanMarketEventType(value: unknown): MarketEvent["type"] {
  const type = toStringValue(value);

  switch (type) {
    case 'ticker':
    case 'quote':
    case 'full':
    case 'index':
    case 'oi':
    case 'prev_close':
    case 'market_status':
      return type;
    default:
      return 'trade';
  }
}

function normalizeDhanSide(value: unknown): string | undefined {
  const side = toStringValue(value)?.toUpperCase();
  if (side === 'B') return 'buy';
  if (side === 'S') return 'sell';
  return side?.toLowerCase();
}

function normalizeDhanOrderStatus(status: unknown, data: DhanOrderAlertData): string | undefined {
  const normalizedStatus = toStringValue(status)?.toUpperCase();
  const tradedQty = toNumberValue(data.TradedQty);
  const remainingQty = toNumberValue(data.RemainingQuantity);

  if (
    tradedQty !== undefined &&
    tradedQty > 0 &&
    remainingQty !== undefined &&
    remainingQty > 0 &&
    normalizedStatus !== 'CANCELLED' &&
    normalizedStatus !== 'REJECTED' &&
    normalizedStatus !== 'EXPIRED'
  ) {
    return 'partially_filled';
  }

  switch (normalizedStatus) {
    case 'TRANSIT':
      return 'pending_new';
    case 'PENDING':
      return 'new';
    case 'TRADED':
      return 'filled';
    case 'CANCELLED':
      return 'canceled';
    case 'REJECTED':
      return 'rejected';
    case 'EXPIRED':
      return 'expired';
    default:
      return normalizedStatus?.toLowerCase();
  }
}

// ============ STREAM NAME PARSING ============
const DHAN_INSTRUMENTS_PER_MESSAGE = 100;
const DEFAULT_DHAN_EXCHANGE_SEGMENT = 'NSE_EQ';
const DEFAULT_DHAN_MARKET_MODE = 'ticker';

type DhanMarketMode = 'ticker' | 'quote' | 'full' | 'market_depth';

type DhanRequestCodes = {
  sub: number;
  unsub: number;
};

type DhanInstrument = {
  ExchangeSegment: string;
  SecurityId: string;
};

type DhanSubscriptionMessage = {
  RequestCode: number;
  InstrumentCount: number;
  InstrumentList: DhanInstrument[];
};

type DhanStreamMetadata = DhanInstrument & {
  mode: DhanMarketMode;
};

const DHAN_REQUEST_CODES: Record<DhanMarketMode, DhanRequestCodes> = {
  ticker: { sub: 15, unsub: 16 },
  quote: { sub: 17, unsub: 18 },
  full: { sub: 21, unsub: 22 },
  market_depth: { sub: 23, unsub: 24 },
};

function normalizeDhanMarketMode(value?: string): DhanMarketMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'quote') return 'quote';
  if (normalized === 'full') return 'full';
  if (normalized === 'market_depth' || normalized === 'depth') return 'market_depth';
  return DEFAULT_DHAN_MARKET_MODE;
}

function parseDhanStreamName(streamName: string): DhanStreamMetadata {
  const [securityId, exchangeOrMode, mode] = streamName.split('@');
  const hasExchangeSegment = Boolean(mode);

  return {
    SecurityId: securityId,
    ExchangeSegment: hasExchangeSegment
      ? exchangeOrMode
      : DEFAULT_DHAN_EXCHANGE_SEGMENT,
    mode: normalizeDhanMarketMode(hasExchangeSegment ? mode : exchangeOrMode),
  };
}

// Routing keys include mode, while broker payload symbols remain pure security IDs.
export function extractDhanSymbols(streamNames: string[]): string[] {
  return streamNames.map((name) => {
    const atIndex = name.indexOf('@');
    return atIndex > 0 ? name.substring(0, atIndex) : name;
  });
}

function chunkInstruments(instruments: DhanInstrument[]): DhanInstrument[][] {
  const chunks: DhanInstrument[][] = [];
  for (let i = 0; i < instruments.length; i += DHAN_INSTRUMENTS_PER_MESSAGE) {
    chunks.push(instruments.slice(i, i + DHAN_INSTRUMENTS_PER_MESSAGE));
  }
  return chunks;
}

function buildDhanMarketMessages(
  streamNames: string[],
  action: keyof DhanRequestCodes,
): DhanSubscriptionMessage[] {
  const instrumentsByRequestCode = new Map<number, DhanInstrument[]>();

  for (const streamName of streamNames) {
    const parsed = parseDhanStreamName(streamName);
    if (!parsed.SecurityId) continue;

    const requestCode = DHAN_REQUEST_CODES[parsed.mode][action];
    const instruments = instrumentsByRequestCode.get(requestCode) || [];
    instruments.push({
      ExchangeSegment: parsed.ExchangeSegment,
      SecurityId: parsed.SecurityId,
    });
    instrumentsByRequestCode.set(requestCode, instruments);
  }

  const messages: DhanSubscriptionMessage[] = [];
  for (const [requestCode, instruments] of instrumentsByRequestCode.entries()) {
    for (const chunk of chunkInstruments(instruments)) {
      messages.push({
        RequestCode: requestCode,
        InstrumentCount: chunk.length,
        InstrumentList: chunk,
      });
    }
  }

  return messages;
}

export function getDhanWsUrl(creds: DhanCredentials, source?: string): string {
  const environment = resolveDhanEnvironment(creds);
  if (isDhanTradingSource(source)) {
    return getDhanOrderUpdateWsUrl(environment);
  }

  const baseUrl = getDhanMarketWsUrl(environment);
  return `${baseUrl}?version=2&token=${creds.api_key}&clientId=${creds.client_id}&authType=2`;
}

export function buildDhanAuthMessage(creds: DhanCredentials, source?: string) {
  if (!isDhanTradingSource(source)) return undefined;
  return {
    LoginReq: {
      MsgCode: 42,
      ClientId: creds.client_id,
      Token: creds.api_key ?? creds.access_token,
    },
    UserType: 'SELF',
  };
}

export function buildDhanSubscribeMessage(streamNames: string[], source?: string) {
  if (isDhanTradingSource(source)) return null;
  return buildDhanMarketMessages(streamNames, 'sub');
}

export function buildDhanUnsubscribeMessage(streamNames: string[], source?: string) {
  if (isDhanTradingSource(source)) return null;
  return buildDhanMarketMessages(streamNames, 'unsub');
}

export function parseDhanMessage(buffer: Buffer, source?: string): unknown[] {
  if (!isDhanTradingSource(source)) return parseDhanBinaryPacket(buffer);

  const parsed = JSON.parse(buffer.toString('utf8'));
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function identifyDhanMessageType(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return 'unknown';
  const record = msg as Record<string, unknown>;
  return toStringValue(record.Type) ?? toStringValue(record.type) ?? 'unknown';
}

export function shouldPublishDhanMessage(msg: unknown, source?: string): boolean {
  if (isDhanTradingSource(source)) {
    return (msg as DhanOrderAlertMessage | null)?.Type === DHAN_ORDER_ALERT_TYPE;
  }

  const record = msg as Record<string, unknown> | null;
  return ['ticker', 'quote', 'full'].includes(String(record?.type));
}

export function normalizeDhanOrderUpdate(data: DhanOrderAlertData): MarketEvent | null {
  const orderId = toStringValue(data.OrderNo);
  const clientOrderId = toStringValue(data.CorrelationId);
  const symbol = toStringValue(data.Symbol) ?? toStringValue(data.SecurityId) ?? '*';

  return {
    source: 'dhan',
    symbol,
    type: 'order_update',
    t: Date.now(),
    orderEvent: toStringValue(data.Status)?.toLowerCase(),
    orderId,
    clientOrderId,
    side: normalizeDhanSide(data.TxnType),
    orderStatus: normalizeDhanOrderStatus(data.Status, data),
    filledQty: toNumberValue(data.TradedQty),
    requestedQty: toNumberValue(data.Quantity),
    filledAvgPrice: toNumberValue(data.AvgTradedPrice) ?? toNumberValue(data.TradedPrice),
    orderSymbol: symbol,
    orderType: toStringValue(data.OrderType)?.toLowerCase(),
    executionId: toStringValue(data.ExchOrderNo),
    rejectReason: toStringValue(data.ReasonDescription),
    rawOrderData: data,
  };
}

export function normalizeDhanMessage(msg: unknown, source?: string): MarketEvent | null {
  if (isDhanTradingSource(source)) {
    const data = (msg as DhanOrderAlertMessage | null)?.Data;
    return data ? normalizeDhanOrderUpdate(data) : null;
  }

  const record = msg as Record<string, unknown>;
  if (!record.SecurityId) return null;
  const depth = normalizeDhanDepth(record.Depth);

  return {
    source: 'dhan',
    symbol: toStringValue(record.TradingSymbol) ?? toStringValue(record.SecurityId) ?? '',
    type: normalizeDhanMarketEventType(record.type),
    t: Date.now(),
    p: toNumberValue(record.LTP),
    b: toNumberValue(record.BidPrice),
    B: toNumberValue(record.BidQty),
    a: toNumberValue(record.AskPrice),
    A: toNumberValue(record.AskQty),
    o: toNumberValue(record.Open),
    h: toNumberValue(record.High),
    l: toNumberValue(record.Low),
    c: toNumberValue(record.Close),
    v: toNumberValue(record.Volume),
    ...depth,
  };
}
