import { parseDhanBinaryPacket } from '../../utils/dhanBinaryParser';
import {
  getDhanMarketWsUrl,
  getDhanOrderUpdateWsUrl,
  resolveDhanEnvironment,
} from './environment';
import type { CorezaMarketEvent } from '../../types/marketEvent';

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
// Dhan stream names are just security IDs (e.g., "1234")
function extractDhanSymbols(streamNames: string[]): string[] {
  return streamNames.map((name) => {
    // If stream name contains metadata separator, extract symbol
    const atIndex = name.indexOf('@');
    return atIndex > 0 ? name.substring(0, atIndex) : name;
  });
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

export function buildDhanUnsubscribeMessage(streamNames: string[], source?: string) {
  if (isDhanTradingSource(source)) return null;

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

export function normalizeDhanOrderUpdate(data: DhanOrderAlertData): CorezaMarketEvent | null {
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

export function normalizeDhanMessage(msg: unknown, source?: string): CorezaMarketEvent | null {
  if (isDhanTradingSource(source)) {
    const data = (msg as DhanOrderAlertMessage | null)?.Data;
    return data ? normalizeDhanOrderUpdate(data) : null;
  }

  const record = msg as Record<string, unknown>;
  if (!record.SecurityId) return null;
  return {
    source: 'dhan',
    symbol: toStringValue(record.TradingSymbol) ?? toStringValue(record.SecurityId) ?? '',
    type: 'trade',
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
  };
}

export function isDhanBinarySource(source?: string): boolean {
  return !isDhanTradingSource(source);
}
