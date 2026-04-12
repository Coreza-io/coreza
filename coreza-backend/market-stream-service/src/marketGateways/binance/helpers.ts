import { createHmac } from "crypto";
import type { CorezaMarketEvent } from "../../types/marketEvent";
import { getBinanceTimestamp } from "../../utils/binanceTimeSync";

const BINANCE_AUTH_RECV_WINDOW = 60_000;

// ============ BINANCE REST API ENDPOINTS ============
const BINANCE_REST_ENDPOINTS: Record<
  string,
  { spot: string; futures: string }
> = {
  live: {
    spot: "https://api.binance.com",
    futures: "https://fapi.binance.com",
  },
  testnet: {
    spot: "https://testnet.binance.vision",
    futures: "https://testnet.binancefuture.com",
  },
};

function isFuturesAssetType(creds: any): boolean {
  const assetType = creds.asset_type || creds.assetType || "spot";
  return assetType === "futures";
}

function unwrapBinanceUserDataEnvelope(msg: any): any {
  if (msg && msg.subscriptionId !== undefined && msg.event) {
    return msg.event;
  }
  return msg;
}

// ============ URL BUILDER (source-aware) ============
export function getBinanceWsUrl(creds: any, source?: string): string {
  const isTestnet = creds.environment === "testnet";
  const isFutures = isFuturesAssetType(creds);

  // Trading stream: spot uses WebSocket API, futures still uses listenKey stream
  if (source === "binance_trading") {
    if (isFutures) {
      const listenKey = creds.listenKey;
      if (!listenKey) {
        throw new Error(
          "listenKey is required for binance_trading futures — preConnect must run first",
        );
      }

      return isTestnet
        ? `wss://stream.testnet.binancefuture.com/ws/${listenKey}`
        : `wss://fstream.binance.com/ws/${listenKey}`;
    }

    return isTestnet
      ? "wss://ws-api.testnet.binance.vision/ws-api/v3"
      : "wss://ws-api.binance.com:443/ws-api/v3";
  }

  // Market data stream (default)
  if (isFutures) {
    return isTestnet
      ? "wss://stream.testnet.binancefuture.com/ws"
      : "wss://fstream.binance.com/ws";
  }

  return isTestnet
    ? "wss://stream.testnet.binance.vision/ws"
    : "wss://stream.binance.com:9443/ws";
}

// ============ PRE-CONNECT: Fetch listenKey for User Data Stream (futures only) ============
export async function preConnectBinance(creds: any): Promise<any> {
  if (!isFuturesAssetType(creds)) {
    // Spot trading now authenticates directly over WebSocket API.
    return creds;
  }

  const isTestnet = creds.environment === "testnet";
  const env = isTestnet ? "testnet" : "live";
  const baseUrl = BINANCE_REST_ENDPOINTS[env].futures;

  const endpoint = "/fapi/v1/listenKey";

  const url = `${baseUrl}${endpoint}`;

  // Create listenKey
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": creds.api_key,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create Binance listenKey: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as { listenKey: string };
  const listenKey = data.listenKey;

  if (!listenKey) {
    throw new Error("Binance listenKey response missing listenKey field");
  }

  // Set up 30-minute keepalive interval
  const refreshInterval = setInterval(
    async () => {
      try {
        const refreshResponse = await fetch(url, {
          method: "PUT",
          headers: {
            "X-MBX-APIKEY": creds.api_key,
          },
        });
        if (!refreshResponse.ok) {
          console.error(
            `Failed to refresh Binance listenKey: ${refreshResponse.status}`,
          );
        }
      } catch (err) {
        console.error("Error refreshing Binance listenKey:", err);
      }
    },
    30 * 60 * 1000,
  ); // 30 minutes

  return { ...creds, listenKey, _listenKeyRefreshInterval: refreshInterval };
}

// ============ AUTH (source-aware) ============
export function buildBinanceAuthMessage(creds: any, source?: string): any {
  const isFutures = isFuturesAssetType(creds);
  if (source !== "binance_trading" || isFutures) {
    return null;
  }

  if (!creds.secret_key) {
    throw new Error(
      "Binance secret_key is missing from credentials — cannot sign auth message",
    );
  }

  const timestamp = getBinanceTimestamp(
    creds.environment === "testnet" ? "testnet" : "live",
    isFutures ? "futures" : "spot",
  );
  const queryString = `apiKey=${creds.api_key}&recvWindow=${BINANCE_AUTH_RECV_WINDOW}&timestamp=${timestamp}`;
  // HMAC-SHA256 signing — for RSA/Ed25519 keys, different signing logic would be needed
  const signature = createHmac("sha256", creds.secret_key)
    .update(queryString)
    .digest("hex");

  return {
    id: "uds-subscribe",
    method: "userDataStream.subscribe.signature",
    params: {
      apiKey: creds.api_key,
      recvWindow: BINANCE_AUTH_RECV_WINDOW,
      timestamp,
      signature,
    },
  };
}

export function isBinanceAuthSuccess(msg: any, source?: string): boolean {
  if (source !== "binance_trading") return false;
  return msg?.status === 200 && msg?.result?.subscriptionId !== undefined;
}

export function isBinanceAuthError(msg: any, source?: string): boolean {
  if (source !== "binance_trading") return false;
  return typeof msg?.status === "number" && msg.status !== 200;
}

// ============ SUBSCRIBE/UNSUBSCRIBE (source-aware) ============
export function buildBinanceSubscribeMessage(
  stream: string[],
  source?: string,
) {
  // Trading stream: no subscription needed — User Data Stream auto-sends all account events
  if (source === "binance_trading") {
    return null;
  }
  return { method: "SUBSCRIBE", params: stream, id: Date.now() };
}

export function buildBinanceUnsubscribeMessage(
  stream: string[],
  source?: string,
) {
  // Trading stream: no unsubscription needed
  if (source === "binance_trading") {
    return null;
  }
  return { method: "UNSUBSCRIBE", params: stream, id: Date.now() };
}

// ============ MESSAGE PARSING ============
export function parseBinanceMessage(buffer: Buffer): any[] {
  return [JSON.parse(buffer.toString())];
}

export function identifyBinanceMessageType(msg: any): string {
  return unwrapBinanceUserDataEnvelope(msg).e;
}

// ============ PUBLISH FILTER (source-aware) ============
export function shouldPublishBinanceMessage(
  msg: any,
  source?: string,
): boolean {
  const eventMsg = unwrapBinanceUserDataEnvelope(msg);

  if (source === "binance_trading") {
    // Spot: executionReport, Futures: ORDER_TRADE_UPDATE
    return (
      eventMsg.e === "executionReport" || eventMsg.e === "ORDER_TRADE_UPDATE"
    );
  }
  return [
    "trade",
    "aggTrade",
    "kline",
    "bookTicker",
    "24hrTicker",
    "miniTicker",
    "depthUpdate",
  ].includes(eventMsg.e);
}

// ============ CONTROL MESSAGES ============
export function handleBinanceControlMessage(
  msg: any,
  logger: any,
  source?: string,
) {
  const eventMsg = unwrapBinanceUserDataEnvelope(msg);

  if (source === "binance_trading") {
    if (msg?.status === 200 && msg?.result?.subscriptionId !== undefined) {
      logger.info(
        {
          source: "binance_trading",
          subscriptionId: msg.result.subscriptionId,
        },
        "Binance user data stream subscribed",
      );
      return;
    }

    if (typeof msg?.status === "number" && msg.status !== 200) {
      logger.warn(
        { source: "binance_trading", status: msg.status, msg },
        "Binance WebSocket API control error",
      );
      return;
    }

    // User Data Stream events that aren't order updates (e.g., outboundAccountPosition, balanceUpdate)
    if (
      eventMsg.e === "outboundAccountPosition" ||
      eventMsg.e === "balanceUpdate" ||
      eventMsg.e === "ACCOUNT_UPDATE"
    ) {
      logger.info(
        { source: "binance_trading", eventType: eventMsg.e },
        "Account event received",
      );
    }
    return;
  }

  if (eventMsg.e !== undefined) {
    const msgId =
      eventMsg.s && eventMsg.E
        ? `${eventMsg.s}:${eventMsg.e}:${eventMsg.k?.i}:${eventMsg.E}`
        : undefined;
    logger.info({ source: "binance", id: msgId }, "Subscription confirmed");
  }
}

// ============ ORDER STATUS MAPPING ============
const BINANCE_ORDER_STATUS_MAP: Record<string, string> = {
  NEW: "new",
  PARTIALLY_FILLED: "partially_filled",
  FILLED: "filled",
  CANCELED: "canceled",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

const BINANCE_EXECUTION_TYPE_MAP: Record<string, string> = {
  NEW: "new",
  TRADE: "fill",
  CANCELED: "canceled",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

// ============ NORMALIZATION (source-aware) ============
export function normalizeBinanceMessage(msg: any, source?: string) {
  const eventMsg = unwrapBinanceUserDataEnvelope(msg);

  // TRADING source - order updates
  if (source === "binance_trading") {
    // Spot: executionReport
    if (eventMsg.e === "executionReport") {
      const cumulativeFilledQty = parseFloat(eventMsg.z) || 0;
      const cumulativeQuoteQty = parseFloat(eventMsg.Z) || 0;
      const lastFilledQty = parseFloat(eventMsg.l) || 0;
      const lastFillPrice = parseFloat(eventMsg.L) || 0;
      const requestedQty = parseFloat(eventMsg.q) || 0;
      const feeAmount = parseFloat(eventMsg.n) || 0;
      const lastQuoteQty = parseFloat(eventMsg.Y) || 0;
      return {
        source: "binance" as const,
        symbol: eventMsg.s?.toUpperCase() || "*",
        type: "order_update" as const,
        t: eventMsg.T || eventMsg.E || Date.now(),

        orderEvent:
          BINANCE_EXECUTION_TYPE_MAP[eventMsg.x] || eventMsg.x?.toLowerCase(),
        orderStatus:
          BINANCE_ORDER_STATUS_MAP[eventMsg.X] || eventMsg.X?.toLowerCase(),

        orderId: eventMsg.i != null ? String(eventMsg.i) : undefined,
        clientOrderId: eventMsg.c || undefined,
        executionId: eventMsg.I != null ? String(eventMsg.I) : undefined,
        tradeId: eventMsg.t != null ? String(eventMsg.t) : undefined,

        side: eventMsg.S?.toLowerCase(),
        orderSymbol: eventMsg.s?.toUpperCase() || "*",
        orderType: eventMsg.o?.toLowerCase(),

        requestedQty,
        lastFilledQty,
        filledQty: cumulativeFilledQty,
        cumulativeFilledQty,
        lastFillPrice,
        filledAvgPrice:
          cumulativeFilledQty > 0
            ? cumulativeQuoteQty / cumulativeFilledQty
            : 0,
        lastQuoteQty,
        cumulativeQuoteQty,

        feeAmount,
        feeAsset: eventMsg.N || undefined,

        eventTime: eventMsg.E || undefined,
        transactionTime: eventMsg.T || undefined,
        orderCreateTime: eventMsg.O || undefined,
        workingTime: eventMsg.W || undefined,

        rejectReason:
          eventMsg.r && eventMsg.r !== "NONE" ? eventMsg.r : undefined,
        isMaker: typeof eventMsg.m === "boolean" ? eventMsg.m : undefined,
        isOnBook: typeof eventMsg.w === "boolean" ? eventMsg.w : undefined,
        stpMode: eventMsg.V || undefined,

        rawOrderData: eventMsg,
      };
    }

    // Futures: ORDER_TRADE_UPDATE
    if (eventMsg.e === "ORDER_TRADE_UPDATE") {
      const o = eventMsg.o || {};
      return {
        source: "binance" as any,
        symbol: o.s?.toUpperCase() || "*",
        type: "order_update" as const,
        t: eventMsg.E || Date.now(),
        orderEvent: BINANCE_EXECUTION_TYPE_MAP[o.x] || o.x?.toLowerCase(),
        orderId: String(o.i),
        clientOrderId: o.c || undefined,
        side: o.S?.toLowerCase(),
        filledQty: parseFloat(o.z) || 0,
        filledAvgPrice: parseFloat(o.ap) || 0,
        orderStatus: BINANCE_ORDER_STATUS_MAP[o.X] || o.X?.toLowerCase(),
        orderSymbol: o.s,
        requestedQty: parseFloat(o.q) || 0,
        executionId: o.t ? String(o.t) : undefined,
        orderType: o.o?.toLowerCase(),
        feeAmount: parseFloat(o.n) || 0,
        feeAsset: o.N || undefined,
        rawOrderData: eventMsg,
      };
    }

    return null;
  }

  // MARKET DATA source (default)
  const symbol = eventMsg.s?.toUpperCase();
  const t = eventMsg.E;

  switch (eventMsg.e) {
    case "trade":
      return {
        symbol,
        t,
        p: parseFloat(eventMsg.p),
        q: parseFloat(eventMsg.q),
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "aggTrade":
      return {
        symbol,
        t,
        p: parseFloat(eventMsg.p),
        q: parseFloat(eventMsg.q),
        type: eventMsg.e,
        source: "binance" as const,
        aggregateTradeId: eventMsg.a,
        firstTradeId: eventMsg.f,
        lastTradeId: eventMsg.l,
        isBuyerMaker: eventMsg.m,
      };

    case "kline": {
      const k = eventMsg.k;
      return {
        symbol,
        t: k.t,
        o: parseFloat(k.o),
        h: parseFloat(k.h),
        l: parseFloat(k.l),
        c: parseFloat(k.c),
        v: parseFloat(k.v),
        timeframe: k.i,
        isClosed: k.x,
        type: eventMsg.e,
        source: "binance" as const,
      };
    }

    case "bookTicker":
      return {
        symbol,
        t,
        b: parseFloat(eventMsg.b),
        B: parseFloat(eventMsg.B),
        a: parseFloat(eventMsg.a),
        A: parseFloat(eventMsg.A),
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "24hrTicker":
      return {
        symbol,
        t,
        c: parseFloat(eventMsg.c),
        pc: parseFloat(eventMsg.p),
        pcp: parseFloat(eventMsg.P),
        v: parseFloat(eventMsg.v),
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "miniTicker":
      return {
        symbol,
        t,
        c: parseFloat(eventMsg.c),
        o: parseFloat(eventMsg.o),
        h: parseFloat(eventMsg.h),
        l: parseFloat(eventMsg.l),
        v: parseFloat(eventMsg.v),
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "depthUpdate":
      return {
        symbol,
        t,
        bids: eventMsg.b?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        asks: eventMsg.a?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        type: eventMsg.e,
        source: "binance" as const,
      };

    default:
      return null;
  }
}
