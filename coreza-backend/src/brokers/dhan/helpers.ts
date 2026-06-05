import { v4 as uuidv4 } from "uuid";
import { lookupSecurityId } from "./scripMaster";
import type { Bar, BarSeriesOutput } from "../types";
import { toBarSeries } from "../types";

export interface DhanBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type DhanCandleInput = {
  symbol?: string;
  exchangeSegment?: string;
  start?: string;
  end?: string;
  lookback?: string | number;
  interval?: string | number;
  instrument?: string;
  expiryCode?: string | number;
};

type DhanCredentials = {
  client_id?: string;
};

type DhanCandleBaseBody = {
  securityId: string;
  exchangeSegment: string;
  instrument: string;
  fromDate: string;
  toDate: string;
  oi: false;
  expiryCode?: number;
};

type DhanIntradayBody = DhanCandleBaseBody & {
  interval: string;
};

type DhanModifyOrderInput = {
  orderId?: string | number;
  orderType?: string;
  type?: string;
  quantity?: string | number;
  qty?: string | number;
  price?: string | number;
  triggerPrice?: string | number;
  validity?: string;
  disclosedQuantity?: string | number;
  legName?: string;
};

type DhanModifyOrderBody = {
  dhanClientId: string;
  orderType?: string;
  quantity?: string | number;
  price?: string | number;
  triggerPrice?: string | number;
  validity?: string;
  disclosedQuantity?: string | number;
  legName?: string;
};

function formatDhanDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function resolveDateRange(input: DhanCandleInput): {
  fromDate: string;
  toDate: string;
} {
  let startDate = input.start;
  let endDate = input.end;
  const lb = Number(input.lookback) || 0;

  if ((!startDate || !endDate) && lb > 0) {
    const now = new Date();
    const sd = new Date(now);
    const interval = Number(input.interval);

    if (Number.isFinite(interval) && interval > 0) {
      sd.setMinutes(now.getMinutes() - lb * interval);
    } else {
      sd.setDate(now.getDate() - lb);
    }

    startDate = startDate || formatDhanDateTime(sd);
    endDate = endDate || formatDhanDateTime(now);
  }

  if (!startDate || !endDate) {
    throw new Error(
      "Either lookback or both from_date and to_date must be provided",
    );
  }

  return { fromDate: startDate, toDate: endDate };
}

async function buildDhanCandleBaseBody(
  input: DhanCandleInput,
): Promise<DhanCandleBaseBody> {
  const { symbol } = input;
  if (!symbol) throw new Error("Symbol is required for get_candle");

  const exchangeSegment = input.exchangeSegment || "NSE_EQ";
  const securityId = await lookupSecurityId(symbol, exchangeSegment);
  if (!securityId) {
    throw new Error(
      `Security ID not found for symbol="${symbol}" segment="${exchangeSegment}"`,
    );
  }

  const { fromDate, toDate } = resolveDateRange(input);

  return {
    securityId,
    exchangeSegment,
    instrument: input.instrument || "",
    fromDate,
    toDate,
    oi: false,
  };
}

function hasProvidedValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function fromDhanBar(b: DhanBar): Bar {
  return {
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  };
}

export async function buildDhanPlaceOrder(input: any, creds: any) {
  const {
    symbol,
    exchange_segment = "NSE_EQ",
    side = "buy",
    type = "market",
    productType = "CNC",
    validity = "DAY",
    qty = 1,
    disclosedQuantity = 0,
    price = "",
    triggerPrice = "",
    afterMarketOrder = false,
    amoTime = "",
    boProfitValue = 0,
    boStopLossValue = 0,
    drvExpiryDate = "",
    drvOptionType = "",
    drvStrikePrice = 0,
  } = input;
  const transactionType = String(input.transactionType ?? side).toUpperCase();
  const orderType = String(input.orderType ?? type).toUpperCase();
  const quantity = input.quantity ?? qty;

  if (!symbol || !quantity || !transactionType) {
    throw new Error(
      "Symbol, quantity, and transactionType are required for place_order",
    );
  }

  const securityId = await lookupSecurityId(symbol, exchange_segment);
  if (!securityId) {
    throw new Error(
      `Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`,
    );
  }

  if (!creds.client_id) {
    throw new Error(
      "Dhan client_id missing in credentials (required for order)",
    );
  }

  const priceVal = ["LIMIT", "STOP_LOSS"].includes(orderType)
    ? Number(price) || 0
    : 0;
  const triggerPriceVal = ["STOP_LOSS", "STOP_LOSS_MARKET"].includes(
    orderType,
  )
    ? Number(triggerPrice) || 0
    : 0;

  return {
    dhanClientId: creds.client_id,
    correlationId: input._idempotencyKey || uuidv4(),
    transactionType,
    exchangeSegment: exchange_segment,
    productType,
    orderType,
    validity,
    securityId,
    quantity: Number(quantity),
    disclosedQuantity: Number(disclosedQuantity) || 0,
    price: priceVal,
    triggerPrice: triggerPriceVal,
    afterMarketOrder,
    ...(afterMarketOrder === true && { amoTime }),
    boProfitValue,
    boStopLossValue,
    drvExpiryDate,
    drvOptionType,
    drvStrikePrice,
  };
}

export async function buildDhanHistoricalBody(
  input: DhanCandleInput,
): Promise<DhanCandleBaseBody> {
  return buildDhanCandleBaseBody(input);
}

export async function buildDhanIntradayBody(
  input: DhanCandleInput,
): Promise<DhanIntradayBody> {
  const body = await buildDhanCandleBaseBody(input);

  return {
    ...body,
    interval: String(input.interval || ""),
  };
}

export function buildDhanModifyOrder(
  input: DhanModifyOrderInput,
  creds: DhanCredentials,
): DhanModifyOrderBody {
  if (!input.orderId) {
    throw new Error("orderId is required for modify_order");
  }

  if (!creds.client_id) {
    throw new Error(
      "Dhan client_id missing in credentials (required for order modification)",
    );
  }

  const body: DhanModifyOrderBody = {
    dhanClientId: creds.client_id,
  };
  const orderType = input.orderType ?? input.type;
  const quantity = input.quantity ?? input.qty;

  if (hasProvidedValue(orderType)) {
    body.orderType = String(orderType).toUpperCase();
  }
  if (hasProvidedValue(quantity)) body.quantity = quantity;
  if (hasProvidedValue(input.price)) body.price = input.price;
  if (hasProvidedValue(input.triggerPrice)) {
    body.triggerPrice = input.triggerPrice;
  }
  if (hasProvidedValue(input.validity)) {
    body.validity = String(input.validity).toUpperCase();
  }
  if (hasProvidedValue(input.disclosedQuantity)) {
    body.disclosedQuantity = input.disclosedQuantity;
  }
  if (hasProvidedValue(input.legName)) body.legName = input.legName;

  return body;
}

export function transformDhanCandles(raw: any, input: any): BarSeriesOutput {
  const open = raw.open || [];
  const high = raw.high || [];
  const low = raw.low || [];
  const close = raw.close || [];
  const volume = raw.volume || [];
  const ts = raw.timestamp || [];

  let candles: any[] = [];

  if (
    Array.isArray(open) &&
    Array.isArray(high) &&
    Array.isArray(low) &&
    Array.isArray(close) &&
    Array.isArray(volume) &&
    Array.isArray(ts)
  ) {
    for (let i = 0; i < open.length; ++i) {
      candles.push({
        t: ts[i],
        o: open[i],
        h: high[i],
        l: low[i],
        c: close[i],
        v: volume[i],
      });
    }
  } else if (Array.isArray(raw.data)) {
    candles = raw.data.map((bar: any) => ({
      t: bar.timestamp || bar.t || bar.T,
      o: bar.open || bar.o || bar.O,
      h: bar.high || bar.h || bar.H,
      l: bar.low || bar.l || bar.L,
      c: bar.close || bar.c || bar.C,
      v: bar.volume || bar.v || bar.V,
    }));
  }

  const dhanBars: DhanBar[] = candles.map((c) => ({
    time: typeof c.t === "string" ? Date.parse(c.t) : c.t,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    volume: c.v,
  }));

  return toBarSeries(
    input.symbol,
    input.timeframe || input.interval || "1",
    dhanBars.map(fromDhanBar),
  );
}
