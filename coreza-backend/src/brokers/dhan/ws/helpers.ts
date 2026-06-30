import { parseDhanBinaryPacket } from '../../../utils/dhanBinaryParser';
import { createLogger } from '../../../utils/logger';
import {
  getDhanMarketWsUrl,
  getDhanOrderUpdateWsUrl,
  resolveDhanEnvironment,
} from '../environment';
import type { MarketEvent } from '../../../types/marketEvent';

const dhanLogger = createLogger('DhanGateway');

const DHAN_TRADING_SOURCE = 'dhan_trading';
const DHAN_ORDER_ALERT_TYPE = 'order_alert';
const DHAN_FEED_DISCONNECT_TYPE = 'feed_disconnect';
const FATAL_DHAN_FEED_DISCONNECT_CODES = new Set([806, 807, 808, 809, 810, 813, 814]);

type DhanCredentials = {
  api_key?: string;
  access_token?: string;
  client_id?: string;
  environment?: string;
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

function resolveDhanMarketToken(creds: DhanCredentials): string | undefined {
  return toStringValue(creds.api_key) ?? toStringValue(creds.access_token);
}

function validateDhanMarketCredentials(creds: DhanCredentials): {
  token: string;
  clientId: string;
} {
  const token = resolveDhanMarketToken(creds);
  const clientId = toStringValue(creds.client_id);
  const environment = resolveDhanEnvironment(creds);
  dhanLogger.info({
    environment,
    hasToken: Boolean(token),
    tokenLength: token?.length ?? 0,
    hasClientId: Boolean(clientId),
  }, 'Dhan market credentials resolved');
  if (!token) throw new Error('Dhan access token missing in credentials (api_key or access_token required)');
  if (!clientId) throw new Error('Dhan client_id missing in credentials');
  return { token, clientId };
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

type DhanInstrumentMeta = {
  symbol: string;
  securityId: string;
  exchange: string;
};

type DhanStreamMetadata = DhanInstrument & DhanInstrumentMeta & {
  mode: DhanMarketMode;
};

const symbolToSecurityId = new Map<string, DhanInstrumentMeta>();
const securityIdToSymbol = new Map<string, DhanInstrumentMeta>();

function dhanSymbolKey(exchange: string, symbol: string): string {
  return `${String(exchange).toUpperCase()}:${String(symbol).toUpperCase()}`;
}

function dhanSecurityIdKey(exchange: string, securityId: string): string {
  return `${String(exchange).toUpperCase()}:${String(securityId)}`;
}

/**
 * Seed the in-memory symbol <-> securityId map once at subscribe time.
 * Never called per tick. Module-level maps survive reconnect; restart
 * durability is provided by the snapshot helpers below.
 */
export function registerDhanInstrument(
  exchange: string,
  symbol: string,
  securityId: string,
): void {
  const exch =
    String(exchange || DEFAULT_DHAN_EXCHANGE_SEGMENT).toUpperCase() ||
    DEFAULT_DHAN_EXCHANGE_SEGMENT;
  const sym = String(symbol).toUpperCase();
  const secId = String(securityId);
  if (!sym || !secId) return;

  const meta: DhanInstrumentMeta = {
    symbol: sym,
    securityId: secId,
    exchange: exch,
  };
  symbolToSecurityId.set(dhanSymbolKey(exch, sym), meta);
  securityIdToSymbol.set(dhanSecurityIdKey(exch, secId), meta);
}

/** Snapshot the map for Redis persistence (one-time, never per tick). */
export function getDhanInstrumentSnapshot(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, meta] of securityIdToSymbol.entries()) {
    snapshot[key] = JSON.stringify(meta);
  }
  return snapshot;
}

/** Rehydrate the map from a Redis snapshot at startup. */
export function loadDhanInstrumentSnapshot(
  snapshot: Record<string, string> | null | undefined,
): void {
  if (!snapshot) return;
  for (const value of Object.values(snapshot)) {
    try {
      const meta = JSON.parse(value) as DhanInstrumentMeta;
      registerDhanInstrument(meta.exchange, meta.symbol, meta.securityId);
    } catch {
      // ignore malformed entries
    }
  }
}

function resolveDhanSecurityId(
  exchange: string,
  symbol: string,
): string | undefined {
  const meta = symbolToSecurityId.get(dhanSymbolKey(exchange, symbol));
  if (meta) return meta.securityId;
  // A numeric symbol is already the securityId.
  if (/^\d+$/.test(symbol)) return symbol;
  return undefined;
}

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
  const parts = streamName.split('@');

  // Legacy 4-part: symbol@securityId@exchange@mode (backward compatible)
  if (parts.length >= 4) {
    const [symbol, securityId, exchange, mode] = parts;
    const exchangeSegment = (exchange || DEFAULT_DHAN_EXCHANGE_SEGMENT).toUpperCase();
    return {
      symbol,
      securityId,
      exchange: exchangeSegment,
      SecurityId: securityId,
      ExchangeSegment: exchangeSegment,
      mode: normalizeDhanMarketMode(mode),
    };
  }

  // Canonical 3-part: symbol@exchange@mode
  if (parts.length === 3) {
    const [symbol, exchange, mode] = parts;
    const exchangeSegment = (exchange || DEFAULT_DHAN_EXCHANGE_SEGMENT).toUpperCase();
    const securityId = resolveDhanSecurityId(exchangeSegment, symbol);

    if (!securityId) {
      throw new Error(
        `Unable to resolve Dhan securityId for ${streamName}. ` +
          `Seed the Dhan resolution map with SYMBOL:securityId before subscribing.`,
      );
    }

    return {
      symbol,
      securityId,
      exchange: exchangeSegment,
      SecurityId: securityId,
      ExchangeSegment: exchangeSegment,
      mode: normalizeDhanMarketMode(mode),
    };
  }

  // Legacy 2-part: securityId@mode
  const [securityId, mode] = parts;
  return {
    symbol: securityId,
    securityId,
    exchange: DEFAULT_DHAN_EXCHANGE_SEGMENT,
    SecurityId: securityId,
    ExchangeSegment: DEFAULT_DHAN_EXCHANGE_SEGMENT,
    mode: normalizeDhanMarketMode(mode),
  };
}

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

  const { token, clientId } = validateDhanMarketCredentials(creds);
  const baseUrl = getDhanMarketWsUrl(environment);
  return `${baseUrl}?version=2&token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&authType=2`;
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
  const messages = buildDhanMarketMessages(streamNames, 'sub');
  for (const message of messages) {
    dhanLogger.debug({
      RequestCode: message.RequestCode,
      InstrumentCount: message.InstrumentCount,
      instruments: message.InstrumentList.map((instrument) => `${instrument.ExchangeSegment}:${instrument.SecurityId}`),
    }, 'Dhan subscribe payload generated');
  }
  return messages;
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
  if (record.type === DHAN_FEED_DISCONNECT_TYPE) return DHAN_FEED_DISCONNECT_TYPE;
  return toStringValue(record.Type) ?? toStringValue(record.type) ?? 'unknown';
}

export function isDhanFeedDisconnectMessage(msg: unknown): boolean {
  return Boolean(msg && typeof msg === 'object' && (msg as Record<string, unknown>).type === DHAN_FEED_DISCONNECT_TYPE);
}

export function describeDhanFeedDisconnect(msg: unknown, streamSource?: string): string {
  const record = msg as Record<string, unknown>;
  const code = toNumberValue(record.reasonCode);
  const reason = toStringValue(record.reasonText) ?? 'Unknown Dhan feed disconnect reason';
  const securityId = toStringValue(record.SecurityId) ?? 'unknown';
  const exchange = toStringValue(record.ExchangeSegment) ?? 'unknown';
  const stream = streamSource ?? 'unknown';
  return `code=${code ?? 'unknown'} reason="${reason}" streamSource=${stream} securityId=${securityId} exchange=${exchange}`;
}

export function isFatalDhanControlMessage(msg: unknown): boolean {
  if (!isDhanFeedDisconnectMessage(msg)) return false;
  const code = toNumberValue((msg as Record<string, unknown>).reasonCode);
  return code !== undefined && FATAL_DHAN_FEED_DISCONNECT_CODES.has(code);
}

export function shouldPublishDhanMessage(msg: unknown, source?: string): boolean {
  if (isDhanTradingSource(source)) {
    return (msg as DhanOrderAlertMessage | null)?.Type === DHAN_ORDER_ALERT_TYPE;
  }

  const record = msg as Record<string, unknown> | null;
  if (isDhanFeedDisconnectMessage(msg)) return false;
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
  const securityId = toStringValue(record.SecurityId);
  if (!securityId) return null;
  const exchange =
    toStringValue(record.ExchangeSegment) ?? DEFAULT_DHAN_EXCHANGE_SEGMENT;
  const meta = securityIdToSymbol.get(
    dhanSecurityIdKey(exchange, securityId),
  );
  const depth = normalizeDhanDepth(record.Depth);

  return {
    source: 'dhan',
    symbol: meta?.symbol ?? toStringValue(record.TradingSymbol) ?? securityId,
    securityId,
    exchange,
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
