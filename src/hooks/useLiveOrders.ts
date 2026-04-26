export interface LiveOrderEvent {
  id: string;
  kind: "fill";
  time: string;
  status: string;
  price?: number;
  quantity?: number;
  rejectReason?: string;
  trailPrice?: number;
  trailPercent?: number;
  timeInForce?: string;
}

export interface LiveOrder {
  orderId?: string;
  symbol: string;
  side: string;
  orderType: string;
  time: string;
  quantity: number;
  avgFillPrice: number;
  limitPrice?: number;
  stopPrice?: number;
  trailPrice?: number;
  trailPercent?: number;
  timeInForce?: string;
  rejectReason?: string;
  status: string;
  tag?: string;
  totalCommission: number;
  commissionAsset?: string;
  quoteAsset?: string;
  events: LiveOrderEvent[];
}

export interface LiveOrdersResult {
  orders: LiveOrder[];
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
  trail_price?: number | null;
  trail_percent?: number | null;
  //time_in_force?: string | null;
  timeInForce?: string | null;
  tag?: string | null;
  algo_id?: string | null;
  reject_reason?: string | null;
};

const KNOWN_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH", "BNB", "EUR"];

const STATUS_PROGRESS: Record<string, number> = {
  new: 0,
  submitted: 1,
  pending_new: 1,
  partially_filled: 2,
  partial: 2,
  filled: 3,
  cancelled: 4,
  canceled: 4,
  rejected: 4,
  expired: 4,
};

const getQuoteAsset = (symbol?: string): string | undefined => {
  const normalized = String(symbol ?? "")
    .trim()
    .toUpperCase();
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
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "partially_filled") return "Partial";
  if (normalized === "cancelled" || normalized === "canceled")
    return "Cancelled";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "submitted" || normalized === "pending_new")
    return "Submitted";
  if (normalized === "new") return "Submitted";
  if (normalized === "expired") return "Expired";
  if (normalized === "filled" || normalized === "") return "Filled";
  return titleCase(status) || "Filled";
};

const statusRank = (status?: string | null): number => {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "new") {
    return STATUS_PROGRESS.submitted;
  }
  return STATUS_PROGRESS[normalized] ?? 0;
};

const resolveTrailPrice = (row?: RawFill): number | undefined => {
  if (!row) return undefined;
  const candidate = row.trail_price;
  return candidate == null ? undefined : toNumber(candidate);
};

const resolveTrailPercent = (row?: RawFill): number | undefined => {
  if (!row) return undefined;
  const candidate = row.trail_percent;
  return candidate == null ? undefined : toNumber(candidate);
};

const resolveTimeInForce = (row?: RawFill): string | undefined => {
  if (!row) return undefined;
  const candidate = row.timeInForce;
  return candidate ? String(candidate) : undefined;
};

const resolveRejectReason = (row?: RawFill): string | undefined => {
  if (!row) return undefined;
  if (row.reject_reason) return row.reject_reason;
  return undefined;
};

export const aggregateFillsToOrders = (fills: RawFill[]): LiveOrdersResult => {
  const rows = (fills ?? []).filter((row) => !String(row.algo_id ?? "").trim());

  const grouped = new Map<string, RawFill[]>();

  for (const row of rows) {
    const orderId = String(row.order_id ?? "").trim();
    const fillId = String(row.fill_id ?? row.id ?? "").trim();

    let canonicalKey = "";
    if (orderId) canonicalKey = `order:${orderId}`;
    else if (fillId) canonicalKey = `fill:${fillId}`;

    if (!canonicalKey) continue;

    const existing = grouped.get(canonicalKey);
    if (existing) existing.push(row);
    else grouped.set(canonicalKey, [row]);
  }

  const orders = Array.from(grouped.values()).map((group) => {
    const sorted = [...group].sort(
      (a, b) =>
        new Date(a.event_time ?? 0).getTime() -
        new Date(b.event_time ?? 0).getTime(),
    );

    const first = sorted[0];
    const statusLeader =
      [...sorted].sort(
        (a, b) => statusRank(a.fill_status) - statusRank(b.fill_status),
      )[sorted.length - 1] ?? sorted[0];

    const latestRow = sorted[sorted.length - 1];
    const representative = first;
    const totalQty = sorted.reduce((sum, row) => sum + toNumber(row.qty), 0);
    const weightedNotional = sorted.reduce(
      (sum, row) => sum + toNumber(row.qty) * toNumber(row.price),
      0,
    );

    const events: LiveOrderEvent[] = sorted.map((row, index) => {
      return {
        id: String(row.id ?? row.fill_id ?? `${index}`),
        kind: "fill",
        time: row.event_time ?? "",
        status: normalizeStatus(row.fill_status),
        price: toNumber(row.price) || undefined,
        quantity: toNumber(row.qty) || undefined,
        rejectReason: resolveRejectReason(row),
        trailPrice: resolveTrailPrice(row),
        trailPercent: resolveTrailPercent(row),
        timeInForce: resolveTimeInForce(row),
      };
    });

    return {
      orderId: String(first?.order_id ?? "").trim() || undefined,
      symbol: String(representative?.symbol ?? "").toUpperCase(),
      side: String(representative?.side ?? ""),
      orderType: normalizeOrderType(
        representative?.side,
        representative?.order_type,
      ),
      time: first?.event_time ?? "",
      quantity: totalQty,
      avgFillPrice: totalQty > 0 ? weightedNotional / totalQty : 0,
      limitPrice: representative?.limit_price ?? undefined,
      stopPrice: representative?.stop_price ?? undefined,
      trailPrice: resolveTrailPrice(representative),
      trailPercent: resolveTrailPercent(representative),
      timeInForce: resolveTimeInForce(representative),
      rejectReason: resolveRejectReason(latestRow),
      status: normalizeStatus(statusLeader?.fill_status),
      tag: latestRow?.tag ?? undefined,
      totalCommission: sorted.reduce(
        (sum, row) => sum + toNumber(row.commission),
        0,
      ),
      commissionAsset: first?.commission_asset ?? undefined,
      quoteAsset: getQuoteAsset(representative?.symbol),
      events,
    };
  });

  return {
    orders: orders.sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    ),
  };
};
