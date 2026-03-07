import type { CorezaMarketEvent } from "../../types/marketEvent";

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

// ============ URL BUILDER (source-aware) ============
export function getBinanceWsUrl(creds: any, source?: string): string {
  const isTestnet = creds.environment === "testnet";
  const assetType = creds.asset_type || "spot";

  // Trading stream: connect to User Data Stream via listenKey
  if (source === "binance_trading") {
    const listenKey = creds.listenKey;
    if (!listenKey) {
      throw new Error(
        "listenKey is required for binance_trading — preConnect must run first",
      );
    }

    if (assetType === "futures") {
      return isTestnet
        ? `wss://stream.testnet.binancefuture.com/ws/${listenKey}`
        : `wss://fstream.binance.com/ws/${listenKey}`;
    }

    return isTestnet
      ? `wss://stream.testnet.binance.vision/ws/${listenKey}`
      : `wss://stream.binance.com:9443/ws/${listenKey}`;
  }

  // Market data stream (default)
  if (assetType === "futures") {
    return isTestnet
      ? "wss://stream.testnet.binancefuture.com/ws"
      : "wss://fstream.binance.com/ws";
  }

  return isTestnet
    ? "wss://stream.testnet.binance.vision/ws"
    : "wss://stream.binance.com:9443/ws";
}

// ============ PRE-CONNECT: Fetch listenKey for User Data Stream ============
export async function preConnectBinance(creds: any): Promise<any> {
  const isTestnet = creds.environment === "testnet";
  const assetType = creds.asset_type || "spot";
  const env = isTestnet ? "testnet" : "live";
  const baseUrl = BINANCE_REST_ENDPOINTS[env][assetType as "spot" | "futures"];

  const endpoint =
    assetType === "futures" ? "/fapi/v1/listenKey" : "/api/v3/userDataStream";

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
  return msg.e;
}

// ============ PUBLISH FILTER (source-aware) ============
export function shouldPublishBinanceMessage(
  msg: any,
  source?: string,
): boolean {
  if (source === "binance_trading") {
    // Spot: executionReport, Futures: ORDER_TRADE_UPDATE
    return msg.e === "executionReport" || msg.e === "ORDER_TRADE_UPDATE";
  }
  return [
    "trade",
    "aggTrade",
    "kline",
    "bookTicker",
    "24hrTicker",
    "miniTicker",
    "depthUpdate",
  ].includes(msg.e);
}

// ============ CONTROL MESSAGES ============
export function handleBinanceControlMessage(
  msg: any,
  logger: any,
  source?: string,
) {
  if (source === "binance_trading") {
    // User Data Stream events that aren't order updates (e.g., outboundAccountPosition, balanceUpdate)
    if (
      msg.e === "outboundAccountPosition" ||
      msg.e === "balanceUpdate" ||
      msg.e === "ACCOUNT_UPDATE"
    ) {
      logger.info(
        { source: "binance_trading", eventType: msg.e },
        "Account event received",
      );
    }
    return;
  }

  if (msg.e !== undefined) {
    const msgId =
      msg.s && msg.E ? `${msg.s}:${msg.e}:${msg.k?.i}:${msg.E}` : undefined;
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
export function normalizeBinanceMessage(
  msg: any,
  source?: string,
): CorezaMarketEvent | null {
  // TRADING source - order updates
  if (source === "binance_trading") {
    // Spot: executionReport
    if (msg.e === "executionReport") {
      return {
        source: "binance" as any,
        symbol: msg.s?.toUpperCase() || "*",
        type: "order_update" as const,
        t: msg.E || Date.now(),
        orderEvent: BINANCE_EXECUTION_TYPE_MAP[msg.x] || msg.x?.toLowerCase(),
        orderId: String(msg.i),
        side: msg.S?.toLowerCase(),
        filledQty: parseFloat(msg.z) || 0, // Cumulative filled qty
        filledAvgPrice:
          parseFloat(msg.z) > 0
            ? parseFloat(msg.Z) / parseFloat(msg.z) // Cumulative quote qty / cumulative qty
            : 0,
        orderStatus: BINANCE_ORDER_STATUS_MAP[msg.X] || msg.X?.toLowerCase(),
        orderSymbol: msg.s,
      };
    }

    // Futures: ORDER_TRADE_UPDATE
    if (msg.e === "ORDER_TRADE_UPDATE") {
      const o = msg.o || {};
      return {
        source: "binance" as any,
        symbol: o.s?.toUpperCase() || "*",
        type: "order_update" as const,
        t: msg.E || Date.now(),
        orderEvent: BINANCE_EXECUTION_TYPE_MAP[o.x] || o.x?.toLowerCase(),
        orderId: String(o.i),
        side: o.S?.toLowerCase(),
        filledQty: parseFloat(o.z) || 0, // Cumulative filled qty
        filledAvgPrice: parseFloat(o.ap) || 0, // Average price field in futures
        orderStatus: BINANCE_ORDER_STATUS_MAP[o.X] || o.X?.toLowerCase(),
        orderSymbol: o.s,
      };
    }

    return null;
  }

  // MARKET DATA source (default)
  const symbol = msg.s?.toUpperCase();
  const t = msg.E;

  switch (msg.e) {
    case "trade":
      return {
        symbol,
        t,
        p: parseFloat(msg.p),
        q: parseFloat(msg.q),
        type: msg.e,
        source: "binance" as const,
      };

    case "aggTrade":
      return {
        symbol,
        t,
        p: parseFloat(msg.p),
        q: parseFloat(msg.q),
        type: msg.e,
        source: "binance" as const,
        aggregateTradeId: msg.a,
        firstTradeId: msg.f,
        lastTradeId: msg.l,
        isBuyerMaker: msg.m,
      };

    case "kline": {
      const k = msg.k;
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
        type: msg.e,
        source: "binance" as const,
      };
    }

    case "bookTicker":
      return {
        symbol,
        t,
        b: parseFloat(msg.b),
        B: parseFloat(msg.B),
        a: parseFloat(msg.a),
        A: parseFloat(msg.A),
        type: msg.e,
        source: "binance" as const,
      };

    case "24hrTicker":
      return {
        symbol,
        t,
        c: parseFloat(msg.c),
        pc: parseFloat(msg.p),
        pcp: parseFloat(msg.P),
        v: parseFloat(msg.v),
        type: msg.e,
        source: "binance" as const,
      };

    case "miniTicker":
      return {
        symbol,
        t,
        c: parseFloat(msg.c),
        o: parseFloat(msg.o),
        h: parseFloat(msg.h),
        l: parseFloat(msg.l),
        v: parseFloat(msg.v),
        type: msg.e,
        source: "binance" as const,
      };

    case "depthUpdate":
      return {
        symbol,
        t,
        bids: msg.b?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        asks: msg.a?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        type: msg.e,
        source: "binance" as const,
      };

    default:
      return null;
  }
}
