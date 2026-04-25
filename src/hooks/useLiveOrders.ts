export interface LiveOrderFill {
  id: string;
  time: string;
  price: number;
  quantity: number;
  status: string;
  commission: number;
}

export interface LiveOrder {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  time: string;
  quantity: number;
  avgFillPrice: number;
  limitPrice?: number;
  stopPrice?: number;
  status: string;
  tag?: string;
  totalCommission: number;
  commissionAsset?: string;
  quoteAsset?: string;
  fills: LiveOrderFill[];
}

export interface LiveAlgoOrder {
  algoId: string;
  orderId?: string;
  symbol: string;
  side: string;
  orderType: string;
  time: string;
  updatedAt: string;
  triggerPrice?: number;
  stopPrice?: number;
  status: string;
  rejectReason?: string;
  tag?: string;
  quoteAsset?: string;
}

export interface LiveOrdersResult {
  orders: LiveOrder[];
  algoOrders: LiveAlgoOrder[];
}

type RawFill = {
  id?: string;
  fill_id?: string;
  order_id?: string | null;
  symbol?: string;
  side?: string;
  order_type?: string | null;
  event_time?: string;
  qty?: number;
  price?: number;
  fill_status?: string | null;
  commission?: number;
  commission_asset?: string | null;
  limit_price?: number | null;
  stop_price?: number | null;
  tag?: string | null;
  algo_id?: string | null;
  reject_reason?: string | null;
};

const KNOWN_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH", "BNB", "EUR"];

const getQuoteAsset = (symbol?: string): string | undefined => {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) return undefined;

  if (normalized.includes("/")) {
    return normalized.split("/")[1] || undefined;
  }

  for (const quote of KNOWN_QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return quote;
    }
  }

  return undefined;
};

const titleCase = (value?: string | null) =>
  String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const normalizeOrderType = (side?: string, orderType?: string | null) => {
  const orderLabel = titleCase(orderType);
  if (!orderLabel) return "-";
  const sideLabel = titleCase(side);
  return sideLabel ? `${sideLabel} ${orderLabel}` : orderLabel;
};

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStatus = (status?: string | null): string => {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "partially_filled") return "Partial";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "submitted" || normalized === "pending_new") return "Submitted";
  if (normalized === "untriggered" || normalized === "new") return "Untriggered";
  if (normalized === "triggering") return "Triggering";
  if (normalized === "triggered") return "Triggered";
  if (normalized === "finished") return "Finished";
  if (normalized === "expired") return "Expired";
  if (normalized === "filled" || normalized === "") return "Filled";
  return titleCase(status) || "Filled";
};

export const aggregateFillsToOrders = (fills: RawFill[]): LiveOrdersResult => {
  const normalRows = (fills ?? []).filter((fill) => !fill.algo_id);
  const algoRows = (fills ?? []).filter((fill) => !!fill.algo_id);
  const grouped = new Map<string, RawFill[]>();

  for (const fill of normalRows) {
    const orderId = String(fill.order_id ?? "").trim() || String(fill.fill_id ?? fill.id ?? "").trim();
    if (!orderId) continue;

    const existing = grouped.get(orderId);
    if (existing) existing.push(fill);
    else grouped.set(orderId, [fill]);
  }

  const orders: LiveOrder[] = [];

  for (const [orderId, group] of grouped.entries()) {
    const sorted = [...group].sort((a, b) => {
      const ta = new Date(a.event_time ?? 0).getTime();
      const tb = new Date(b.event_time ?? 0).getTime();
      return ta - tb;
    });

    const selected = sorted;
    const first = selected[0];
    const last = selected[selected.length - 1];

    const totalQty = selected.reduce((sum, fill) => sum + toNumber(fill.qty), 0);
    const weightedNotional = selected.reduce(
      (sum, fill) => sum + toNumber(fill.qty) * toNumber(fill.price),
      0,
    );

    const fillRows: LiveOrderFill[] = selected.map((fill, index) => ({
      id: String(fill.id ?? fill.fill_id ?? `${orderId}-${index}`),
      time: fill.event_time ?? "",
      price: toNumber(fill.price),
      quantity: toNumber(fill.qty),
      status: normalizeStatus(fill.fill_status),
      commission: toNumber(fill.commission),
    }));

    orders.push({
      orderId,
      symbol: String(first?.symbol ?? "").toUpperCase(),
      side: String(first?.side ?? ""),
      orderType: normalizeOrderType(first?.side, first?.order_type),
      time: first?.event_time ?? "",
      quantity: totalQty,
      avgFillPrice: totalQty > 0 ? weightedNotional / totalQty : 0,
      limitPrice: first?.limit_price ?? undefined,
      stopPrice: first?.stop_price ?? undefined,
      status: normalizeStatus(last?.fill_status),
      tag: first?.tag ?? undefined,
      totalCommission: selected.reduce((sum, fill) => sum + toNumber(fill.commission), 0),
      commissionAsset: first?.commission_asset ?? undefined,
      quoteAsset: getQuoteAsset(first?.symbol),
      fills: fillRows,
    });
  }

  const sortedOrders = orders.sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  const algoById = new Map<string, { first: RawFill; latest: RawFill }>();
  for (const row of algoRows) {
    const algoId = String(row.algo_id ?? "").trim();
    if (!algoId) continue;
    const existing = algoById.get(algoId);
    if (!existing) {
      algoById.set(algoId, { first: row, latest: row });
      continue;
    }
    const firstTime = new Date(existing.first.event_time ?? 0).getTime();
    const latestTime = new Date(existing.latest.event_time ?? 0).getTime();
    const nextTime = new Date(row.event_time ?? 0).getTime();
    if (nextTime <= firstTime) {
      existing.first = row;
    }
    if (nextTime >= latestTime) {
      existing.latest = row;
    }
  }

  const algoOrders: LiveAlgoOrder[] = Array.from(algoById.entries())
    .map(([algoId, grouped]) => {
      const latest = grouped.latest;
      const first = grouped.first;
      const tag = latest.tag ?? undefined;
      const rejectReason =
        typeof tag === "string" && tag.startsWith("algo:")
          ? tag.slice("algo:".length)
          : latest.reject_reason ?? undefined;
      return {
        algoId,
        orderId: latest.order_id ?? undefined,
        symbol: String(latest.symbol ?? "").toUpperCase(),
        side: String(latest.side ?? ""),
        orderType: normalizeOrderType(latest.side, latest.order_type),
        time: first.event_time ?? latest.event_time ?? "",
        updatedAt: latest.event_time ?? first.event_time ?? "",
        triggerPrice: latest.limit_price ?? undefined,
        stopPrice: latest.stop_price ?? undefined,
        status: normalizeStatus(latest.fill_status),
        rejectReason,
        tag,
        quoteAsset: getQuoteAsset(latest.symbol),
      };
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return { orders: sortedOrders, algoOrders };
};
