import type { CorezaMarketEvent } from "../../types/marketEvent";

// ============ TYPE MAPPING ============
const ALPACA_TYPE_TO_KEY: Record<string, string> = {
  trade: "trades",
  quote: "quotes",
  bar: "bars",
  daily_bar: "dailyBars",
  trades: "trades",
  quotes: "quotes",
  bars: "bars",
  dailyBars: "dailyBars",
};

// ============ URL BUILDER (source-aware) ============
export function getAlpacaWsUrl(creds: any, source?: string): string {
  if (source === "alpaca_news") {
    return "wss://stream.data.alpaca.markets/v1beta1/news";
  }
  if (source === "alpaca_trading") {
    // Trading updates WebSocket (order fills, cancellations, etc.)
    // Paper trading uses paper-api endpoint, live uses api endpoint
    const isPaper = creds.environment
      ? String(creds.environment).toLowerCase() !== "live"
      : undefined;
    return isPaper
      ? "wss://paper-api.alpaca.markets/stream"
      : "wss://api.alpaca.markets/stream";
  }
  if (source === "alpaca_crypto") {
    return "wss://stream.data.alpaca.markets/v1beta3/crypto/us";
  }
  // Default: market data stream
  const feed = creds.feed || "iex";
  return `wss://stream.data.alpaca.markets/v2/${feed}`;
}

// ============ AUTH (source-aware) ============
export function buildAlpacaAuthMessage(creds: any, source?: string) {
  if (source === "alpaca_trading") {
    // Trading stream uses same auth format
    return {
      action: "auth",
      key: creds.api_key,
      secret: creds.secret_key,
    };
  }
  return {
    action: "auth",
    key: creds.api_key,
    secret: creds.secret_key,
  };
}

export function isAlpacaAuthSuccess(msg: any, source?: string): boolean {
  // Trading stream auth success: [{"T":"success","msg":"authenticated"}]
  // Same format as market data, but also handle non-array format
  if (source === "alpaca_trading") {
    if (Array.isArray(msg)) {
      return msg.some(
        (m) =>
          (m.T === "success" && m.msg === "authenticated") ||
          (m.stream === "authorization" && m.data?.status === "authorized"),
      );
    }
    return (
      (msg.T === "success" && msg.msg === "authenticated") ||
      (msg.stream === "authorization" && msg.data?.status === "authorized")
    );
  }
  return Array.isArray(msg)
    ? msg.some((m) => m.T === "success")
    : msg.T === "success";
}

export function isAlpacaAuthError(msg: any, source?: string): boolean {
  if (source === "alpaca_trading") {
    if (Array.isArray(msg)) {
      return msg.some(
        (m) =>
          m.T === "error" ||
          (m.stream === "authorization" && m.data?.status === "unauthorized"),
      );
    }
    return (
      msg.T === "error" ||
      (msg.stream === "authorization" && msg.data?.status === "unauthorized")
    );
  }
  return Array.isArray(msg)
    ? msg.some((m) => m.T === "error")
    : msg.T === "error";
}

// ============ STREAM NAME PARSING ============
// Universal format: symbol@eventType OR symbol@eventType_interval

export function parseAlpacaStreamNames(streamNames: string[]): {
  symbols: string[];
  types: string[];
} {
  const symbols = new Set<string>();
  const types = new Set<string>();

  for (const name of streamNames) {
    const atIndex = name.indexOf("@");

    if (atIndex > 0) {
      const symbol = name.substring(0, atIndex);
      const rest = name.substring(atIndex + 1);

      // bar_1m -> bar
      const type = rest.includes("_") ? rest.split("_")[0] : rest;

      symbols.add(symbol.toUpperCase());
      types.add(type);
    } else {
      // fallback
      symbols.add(name.toUpperCase());
      types.add("trade");
    }
  }

  return {
    symbols: Array.from(symbols),
    types: Array.from(types),
  };
}

// ============ SUBSCRIBE/UNSUBSCRIBE (stream-name based) ============
export function buildAlpacaSubscribeMessage(
  streamNames: string[],
  source?: string,
) {
  // TRADING source: listen to trade_updates
  if (source === "alpaca_trading") {
    return {
      action: "listen",
      data: { streams: ["trade_updates"] },
    };
  }

  // NEWS source: subscribe to news stream
  if (source === "alpaca_news") {
    const { symbols } = parseAlpacaStreamNames(streamNames);
    return {
      action: "subscribe",
      news: symbols.map(toAlpacaNewsTicker),
    };
  }

  // STREAM source (default): parse stream names and build message
  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  const msg: any = { action: "subscribe" };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || t;
    msg[key] = symbols;
  });
  return msg;
}

export function buildAlpacaUnsubscribeMessage(
  streamNames: string[],
  source?: string,
) {
  // TRADING source: no-op (Alpaca doesn't support unsubscribing from trade_updates)
  if (source === "alpaca_trading") {
    return null;
  }

  if (source === "alpaca_news") {
    const { symbols } = parseAlpacaStreamNames(streamNames);
    return {
      action: "unsubscribe",
      news: symbols.map(toAlpacaNewsTicker),
    };
  }

  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  const msg: any = { action: "unsubscribe" };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || t;
    msg[key] = symbols;
  });
  return msg;
}

function toAlpacaNewsTicker(symbol: string): string {
  const upper = String(symbol || "").trim().toUpperCase();
  return upper.includes("/") ? upper.replace(/\//g, "") : upper;
}

// ============ MESSAGE PARSING (shared) ============
export function parseAlpacaMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function identifyAlpacaMessageType(msg: any): string {
  return msg.T;
}

// ============ PUBLISH FILTER (source-aware) ============
export function shouldPublishAlpacaMessage(msg: any, source?: string): boolean {
  if (source === "alpaca_trading") {
    // Trading stream: publish trade_updates events
    return msg.stream === "trade_updates";
  }
  if (source === "alpaca_news") {
    return msg.T === "n"; // News messages
  }
  return ["t", "q", "b", "d"].includes(msg.T); // Market data messages
}

// ============ CONTROL MESSAGES (source-aware for logging) ============
export function handleAlpacaControlMessage(
  msg: any,
  logger: any,
  source?: string,
) {
  const logSource = source || "alpaca";
  const messages = Array.isArray(msg) ? msg : [msg];
  for (const m of messages) {
    if (m.T === "subscription") {
      logger.info(
        { source: logSource, subscriptions: m },
        "Subscription confirmation received",
      );
    } else if (m.T === "error") {
      logger.error({ source: logSource, error: m }, "Error message received");
    } else if (m.T === "success") {
      logger.info(
        { source: logSource, msg: m.msg },
        "Success message received",
      );
    } else if (m.stream === "listening") {
      logger.info(
        { source: logSource, streams: m.data?.streams },
        "Trading stream listening confirmation",
      );
    }
  }
}

// ============ NORMALIZATION (source-aware) ============
export function normalizeAlpacaMessage(
  msg: any,
  source?: string,
): CorezaMarketEvent | null {
  // TRADING source - order updates
  if (source === "alpaca_trading") {
    if (msg.stream !== "trade_updates") return null;

    const data = msg.data || {};
    const order = data.order || {};

    return {
      source: "alpaca" as any,
      symbol: order.symbol?.toUpperCase() || "*",
      type: msg.stream,
      t: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
      orderEvent: data.event,
      orderId: order.id,
      clientOrderId: order.client_order_id,
      side: order.side,
      filledQty: parseFloat(order.filled_qty) || 0,
      filledAvgPrice: parseFloat(order.filled_avg_price) || 0,
      orderStatus: order.status,
      orderSymbol: order.symbol,
      requestedQty: parseFloat(order.qty) || 0,
      positionQty: parseFloat(data.position_qty) || 0,
      executionId: data.execution_id,
      orderType: order.type || order.order_type,
      assetClass: order.asset_class,
      rawOrderData: data,
    };
  }

  // NEWS source
  if (source === "alpaca_news") {
    if (msg.T !== "n") return null;
    return {
      source: "alpaca_news" as any,
      symbol: msg.symbols?.[0]?.toUpperCase() || "*",
      type: "news" as const,
      t: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
      headline: msg.headline,
      summary: msg.summary,
      author: msg.author,
      url: msg.url,
      symbols: msg.symbols,
      newsSource: msg.source,
    } as CorezaMarketEvent;
  }

  // STREAM source (default) - market data
  const symbol = msg.S?.toUpperCase();
  const t = msg.t ? new Date(msg.t).getTime() : Date.now();

  switch (msg.T) {
    case "t":
      return {
        source: "alpaca" as const,
        symbol,
        t,
        type: "trade" as const,
        p: msg.p,
        q: msg.s,
        x: msg.x,
      };
    case "q":
      return {
        source: "alpaca" as const,
        symbol,
        t,
        type: "quote" as const,
        b: msg.bp,
        B: msg.bs,
        a: msg.ap,
        A: msg.as,
      };
    case "b":
      return {
        source: "alpaca" as const,
        symbol,
        t,
        type: "bar" as const,
        o: msg.o,
        h: msg.h,
        l: msg.l,
        c: msg.c,
        v: msg.v,
        vw: msg.vw,
      };
    case "d":
      return {
        source: "alpaca" as const,
        symbol,
        t,
        type: "daily_bar" as const,
        o: msg.o,
        h: msg.h,
        l: msg.l,
        c: msg.c,
        v: msg.v,
      };
    default:
      return null;
  }
}
