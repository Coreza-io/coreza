import { createHmac } from "crypto";
import type { CorezaMarketEvent } from "../../types/marketEvent";
import { getBinanceTimestamp } from "../../utils/binanceTimeSync";

const BINANCE_AUTH_RECV_WINDOW = 60_000;

function isFuturesMarketType(creds: any): boolean {
  const marketType = creds?.marketType;
  return String(marketType || "").toLowerCase() === "futures";
}

function getFuturesListenKeyHttpBase(creds: any): string {
  const isTestnet = creds?.environment === "testnet";
  return isTestnet
    ? "https://demo-fapi.binance.com"
    : "https://fapi.binance.com";
}

async function requestFuturesListenKey(
  creds: any,
  method: "POST" | "PUT" | "DELETE",
): Promise<any> {
  if (!creds?.api_key) {
    throw new Error("Binance api_key is required for futures listenKey flow");
  }

  const baseUrl = getFuturesListenKeyHttpBase(creds);
  const url = `${baseUrl}/fapi/v1/listenKey`;
  const response = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": creds.api_key,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Binance futures listenKey ${method} failed (${response.status}): ${body}`,
    );
  }

  if (method === "POST") {
    return response.json();
  }

  return null;
}

function unwrapBinanceUserDataEnvelope(msg: any): any {
  if (msg && msg.subscriptionId !== undefined && msg.event) {
    return msg.event;
  }
  return msg;
}

function normalizeBinanceIncomingEventType(eventType: string): string {
  return eventType === "continuous_kline" ? "continuousKline" : eventType;
}

function normalizeBinanceIncomingEvent(msg: any): any {
  const eventMsg = unwrapBinanceUserDataEnvelope(msg);
  if (!eventMsg || typeof eventMsg !== "object") {
    return eventMsg;
  }

  if (typeof eventMsg.e === "string") {
    return {
      ...eventMsg,
      e: normalizeBinanceIncomingEventType(eventMsg.e),
    };
  }

  return eventMsg;
}

// ============ URL BUILDER (source-aware) ============
export function getBinanceWsUrl(creds: any, source?: string): string {
  const isTestnet = creds.environment === "testnet";
  const isFutures = isFuturesMarketType(creds);

  // Trading stream: spot uses WebSocket API, futures still uses listenKey stream
  // if (source === "binance_trading") {
  //   if (isFutures) {
  //     const listenKey = creds.listenKey;
  //     if (!listenKey) {
  //       throw new Error(
  //         "listenKey is required for binance_trading futures — preConnect must run first",
  //       );
  //     }

  //     return isTestnet
  //       ? `wss://stream.testnet.binancefuture.com/ws/${listenKey}`
  //       : `wss://fstream.binance.com/ws/${listenKey}`;
  //   }

  //   return isTestnet
  //     ? "wss://ws-api.testnet.binance.vision/ws-api/v3"
  //     : "wss://ws-api.binance.com:443/ws-api/v3";
  // }

  if (source === "binance_trading") {
    if (isFutures) {
      if (!creds?.listenKey) {
        throw new Error(
          "listenKey is required for binance_trading futures — preConnect must run first",
        );
      }
      const host = isTestnet
        ? "fstream.binancefuture.com"
        : "fstream.binance.com";

      const events = [
        "ORDER_TRADE_UPDATE",
        "ALGO_UPDATE",
        "ACCOUNT_UPDATE",
        // verify exact expiry event token from current event page / live test
        "listenKeyExpired",
      ].join("/");

      return `wss://${host}/private/ws?listenKey=${creds.listenKey}&events=${events}`;
    }

    return isTestnet
      ? "wss://ws-api.testnet.binance.vision/ws-api/v3"
      : "wss://ws-api.binance.com:443/ws-api/v3";
  }

  // Market data stream (default)
  if (isFutures) {
    return isTestnet
      ? "wss://fstream.binancefuture.com/ws"
      : "wss://fstream.binance.com/ws";
  }

  return isTestnet
    ? "wss://stream.testnet.binance.vision/ws"
    : "wss://stream.binance.com:9443/ws";
}

// ============ PRE-CONNECT ============
export async function preConnectBinance(
  creds: any,
  source?: string,
): Promise<any> {
  if (source === "binance_trading" && isFuturesMarketType(creds)) {
    const result = await requestFuturesListenKey(creds, "POST");
    if (!result?.listenKey) {
      throw new Error(
        "Binance futures listenKey response missing listenKey field",
      );
    }

    creds.listenKey = result.listenKey;
    console.info("[binance] Started futures listenKey stream");

    if (creds._listenKeyRefreshInterval) {
      clearInterval(creds._listenKeyRefreshInterval);
    }
    creds._listenKeyRefreshInterval = setInterval(
      async () => {
        try {
          await requestFuturesListenKey(creds, "PUT");
          console.info(
            "[binance] Refreshed futures listenKey via REST keepalive",
          );
        } catch (error) {
          console.error(
            "[binance] Failed to refresh futures listenKey via REST keepalive",
            error,
          );
        }
      },
      25 * 60 * 1000,
    );

    creds._closeListenKey = async () => {
      try {
        await requestFuturesListenKey(creds, "DELETE");
        console.info("[binance] Closed futures listenKey during teardown");
      } catch (error) {
        console.error(
          "[binance] Failed to close futures listenKey during teardown",
          error,
        );
      } finally {
        creds.listenKey = undefined;
      }
    };
  }

  return creds;
}

// ============ AUTH (source-aware) ============
// Spot trading:
//   - subscribe directly with userDataStream.subscribe.signature
// Futures trading:
//   - first authenticate the WebSocket session with session.logon
export function buildBinanceAuthMessage(creds: any, source?: string): any {
  if (source !== "binance_trading") {
    return null;
  }

  if (isFuturesMarketType(creds)) {
    return null;
  }

  if (!creds?.api_key) {
    throw new Error(
      "Binance api_key is missing from credentials — cannot build auth message",
    );
  }

  if (!creds?.secret_key) {
    throw new Error(
      "Binance secret_key is missing from credentials — cannot sign auth message",
    );
  }

  const isFutures = isFuturesMarketType(creds);
  const environment = creds.environment === "testnet" ? "testnet" : "live";

  const timestamp = getBinanceTimestamp(
    environment,
    isFutures ? "futures" : "spot",
  );

  const queryString = `apiKey=${creds.api_key}&recvWindow=${BINANCE_AUTH_RECV_WINDOW}&timestamp=${timestamp}`;

  // HMAC-SHA256 signing — for RSA/Ed25519 keys, different signing logic would be needed
  const signature = createHmac("sha256", creds.secret_key)
    .update(queryString)
    .digest("hex");

  // Futures WS API: authenticate the session first
  if (isFutures) {
    return {
      id: "session-logon",
      method: "session.logon",
      params: {
        apiKey: creds.api_key,
        recvWindow: BINANCE_AUTH_RECV_WINDOW,
        timestamp,
        signature,
      },
    };
  }

  // Spot WS API: directly subscribe to user data stream
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
  if (msg === null || msg === undefined) return true;
  if (msg?.id === "session-logon") {
    return msg?.status === 200;
  }
  return msg?.status === 200 && msg?.result?.subscriptionId !== undefined;
}

export function isBinanceAuthError(msg: any, source?: string): boolean {
  if (source !== "binance_trading") return false;
  return typeof msg?.status === "number" && msg.status !== 200;
}

export function buildBinancePostAuthMessage(creds: any, source?: string): any {
  if (source !== "binance_trading") return null;
  return null;
}

export function isBinancePostAuthSuccess(msg: any, source?: string): boolean {
  if (source !== "binance_trading") return false;
  return true;
}

export function buildBinanceKeepaliveMessage(creds: any, source?: string): any {
  if (source !== "binance_trading") return null;
  if (!isFuturesMarketType(creds)) return null;
  return null;
}

// ============ SUBSCRIBE/UNSUBSCRIBE (source-aware) ============
export function buildBinanceSubscribeMessage(
  stream: string[],
  source?: string,
) {
  if (source === "binance_trading") {
    console.error(
      "[binance] Refused market SUBSCRIBE payload on trading socket",
    );
    return null;
  }
  return { method: "SUBSCRIBE", params: stream, id: Date.now() };
}

export function buildBinanceUnsubscribeMessage(
  stream: string[],
  source?: string,
) {
  if (source === "binance_trading") {
    console.error(
      "[binance] Refused market UNSUBSCRIBE payload on trading socket",
    );
    return null;
  }
  return { method: "UNSUBSCRIBE", params: stream, id: Date.now() };
}

// ============ MESSAGE PARSING ============
export function parseBinanceMessage(buffer: Buffer): any[] {
  return [JSON.parse(buffer.toString())];
}

export function identifyBinanceMessageType(msg: any): string {
  return normalizeBinanceIncomingEvent(msg).e;
}

// ============ PUBLISH FILTER (source-aware) ============
export function shouldPublishBinanceMessage(
  msg: any,
  source?: string,
): boolean {
  const eventMsg = normalizeBinanceIncomingEvent(msg);

  if (source === "binance_trading") {
    return (
      eventMsg.e === "ORDER_TRADE_UPDATE" ||
      eventMsg.e === "executionReport" ||
      eventMsg.e === "ALGO_UPDATE" ||
      eventMsg.e === "listenKeyExpired"
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
    "markPriceUpdate",
    "forceOrder",
    "continuousKline",
    "indexPriceUpdate",
    "compositeIndex",
  ].includes(eventMsg.e);
}

// ============ CONTROL MESSAGES ============
export function handleBinanceControlMessage(
  msg: any,
  logger: any,
  source?: string,
) {
  const eventMsg = normalizeBinanceIncomingEvent(msg);

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
  const eventMsg = normalizeBinanceIncomingEvent(msg);

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
        executionId:
          eventMsg.I != null
            ? String(eventMsg.I)
            : eventMsg.t != null
              ? String(eventMsg.t)
              : undefined,
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

        // Top-level event timing
        t: eventMsg.T ?? eventMsg.E ?? Date.now(),
        eventType: eventMsg.e,
        eventTime: eventMsg.E,
        transactionTime: eventMsg.T,

        // Core order execution info
        orderEvent: BINANCE_EXECUTION_TYPE_MAP[o.x] || o.x?.toLowerCase(),
        orderStatus: BINANCE_ORDER_STATUS_MAP[o.X] || o.X?.toLowerCase(),
        orderId: o.i != null ? String(o.i) : undefined,
        clientOrderId: o.c || undefined,
        executionId: o.t != null ? String(o.t) : undefined, // trade id

        // Symbol / side / type
        orderSymbol: o.s,
        side: o.S?.toLowerCase(),
        orderType: o.o?.toLowerCase(),
        originalOrderType: o.ot?.toLowerCase(),
        timeInForce: o.f,
        positionSide: o.ps?.toLowerCase(),

        // Quantities
        requestedQty: parseFloat(o.q) || 0, // original order qty
        filledQty: parseFloat(o.l) || 0, // this event fill qty
        cumulativeFilledQty: parseFloat(o.z) || 0, // total filled qty so far

        // Prices
        requestedPrice: parseFloat(o.p) || 0, // original order price
        stopPrice: parseFloat(o.sp) || 0, // stop price
        lastFilledPrice: parseFloat(o.L) || 0, // this event fill price
        filledAvgPrice: parseFloat(o.ap) || 0, // average fill price so far
        activationPrice: parseFloat(o.AP) || 0, // trailing stop only
        callbackRate: parseFloat(o.cr) || 0, // trailing stop only

        // Fees / pnl
        feeAmount: parseFloat(o.n) || 0,
        feeAsset: o.N || undefined,
        realizedPnl: parseFloat(o.rp) || 0,

        // Flags / behavior
        isMaker: o.m === true,
        reduceOnly: o.R === true,
        closeAll: o.cp === true,
        priceProtect: o.pP === true,
        workingType: o.wt, // MARK_PRICE / CONTRACT_PRICE
        selfTradePreventionMode: o.V, // e.g. EXPIRE_TAKER / EXPIRE_MAKER / EXPIRE_BOTH / NONE
        priceMatchMode: o.pm, // e.g. NONE
        goodTillDate: Number(o.gtd) || 0, // GTD cancel time, 0 if not used

        // Additional numeric fields from Binance payload
        bidNotional: parseFloat(o.b) || 0,
        askNotional: parseFloat(o.a) || 0,
        orderTradeTime: Number(o.T) || 0,
        expiryReasonCode: Number(o.er) || 0,
        rawOrderData: eventMsg,
      };
    }

    if (eventMsg.e === "ALGO_UPDATE") {
      const o = eventMsg.o || {};
      const algoStatus = String(o.X || "").toLowerCase();
      return {
        source: "binance" as any,
        symbol: o.s?.toUpperCase() || "*",
        type: "algo_update" as const,
        t: eventMsg.E ?? Date.now(),
        eventType: eventMsg.e,
        eventTime: eventMsg.E,
        algoId: o.aid != null ? String(o.aid) : undefined,
        clientAlgoId: o.caid || undefined,
        algoStatus,
        orderStatus: algoStatus,
        orderType: o.o?.toLowerCase(),
        side: o.S?.toLowerCase(),
        positionSide: o.ps?.toLowerCase(),
        requestedQty: parseFloat(o.q) || 0,
        triggerPrice: parseFloat(o.tp) || 0,
        requestedPrice: parseFloat(o.p) || 0,
        workingType: o.wt,
        reduceOnly: o.R === true,
        closeAll: o.cp === true,
        priceProtect: o.pP === true,
        orderId: o.ai != null ? String(o.ai) : undefined,
        filledAvgPrice: parseFloat(o.ap) || 0,
        filledQty: parseFloat(o.aq) || 0,
        orderTradeTime: Number(o.tt) || 0,
        rejectReason: o.rm || undefined,
        rawOrderData: eventMsg,
      };
    }

    if (eventMsg.e === "listenKeyExpired") {
      return {
        source: "binance" as any,
        symbol: "*",
        type: "listen_key_expired" as const,
        t: eventMsg.E ?? Date.now(),
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

    case "markPriceUpdate":
      return {
        symbol,
        t,
        markPrice: parseFloat(eventMsg.p),
        indexPrice: parseFloat(eventMsg.i),
        fundingRate: parseFloat(eventMsg.r),
        nextFundingTime: eventMsg.T,
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "forceOrder": {
      const o = eventMsg.o || {};
      return {
        symbol: o.s?.toUpperCase() || symbol,
        t: o.T || t,
        side: o.S,
        orderType: o.o,
        p: parseFloat(o.p),
        q: parseFloat(o.q),
        ap: parseFloat(o.ap),
        status: o.X,
        type: eventMsg.e,
        source: "binance" as const,
      };
    }

    case "continuousKline": {
      const k = eventMsg.k || {};
      return {
        symbol: eventMsg.ps?.toUpperCase() || symbol,
        t: k.t || t,
        o: parseFloat(k.o),
        h: parseFloat(k.h),
        l: parseFloat(k.l),
        c: parseFloat(k.c),
        v: parseFloat(k.v),
        timeframe: k.i,
        contractType: eventMsg.ct.toLowerCase(),
        isClosed: k.x,
        type: eventMsg.e,
        source: "binance" as const,
      };
    }

    case "indexPriceUpdate":
      return {
        symbol: eventMsg.i?.toUpperCase() || symbol,
        t,
        indexPrice: parseFloat(eventMsg.p),
        type: eventMsg.e,
        source: "binance" as const,
      };

    case "compositeIndex":
      return {
        symbol: eventMsg.s?.toUpperCase() || symbol,
        t,
        indexPrice: parseFloat(eventMsg.p),
        constituents: eventMsg.cm || [],
        type: eventMsg.e,
        source: "binance" as const,
      };

    default:
      return null;
  }
}
