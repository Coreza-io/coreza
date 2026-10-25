/** Exact decimal arithmetic at the broker acceptance boundary; projections retain number APIs. */
export class FillDecimal {
  private constructor(readonly units: bigint, readonly scale: number) {}
  static from(value: unknown): FillDecimal {
    if (typeof value !== "string" && typeof value !== "number") throw new Error("Expected a decimal value");
    const text = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || text.length > 128) throw new Error("Invalid decimal value");
    const fraction = match[3] || "";
    const exponent = Number(match[4] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error("Decimal exponent out of range");
    let units = BigInt((match[1] === "-" ? "-" : "") + match[2] + fraction);
    let scale = fraction.length - exponent;
    if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
    return new FillDecimal(units, scale);
  }
  add(other: FillDecimal): FillDecimal {
    const scale = Math.max(this.scale, other.scale);
    return new FillDecimal(this.units * 10n ** BigInt(scale - this.scale) + other.units * 10n ** BigInt(scale - other.scale), scale);
  }
  sub(other: FillDecimal): FillDecimal { return this.add(new FillDecimal(-other.units, other.scale)); }
  mul(other: FillDecimal): FillDecimal { return new FillDecimal(this.units * other.units, this.scale + other.scale); }
  cmp(other: FillDecimal): number { const delta = this.sub(other).units; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
  toString(): string {
    const sign = this.units < 0n ? "-" : "";
    const digits = (this.units < 0n ? -this.units : this.units).toString().padStart(this.scale + 1, "0");
    const text = this.scale ? `${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`.replace(/\.?0+$/, "") : digits;
    return sign + text;
  }
  toNumber(): number {
    const n = Number(this.toString());
    if (!Number.isFinite(n) || FillDecimal.from(n).cmp(this) !== 0) throw new Error("Decimal cannot be represented without loss by the portfolio projection");
    return n;
  }
}

export type FillPriceMode = "execution" | "cumulative_average";
export interface OrderFillCheckpoint {
  quantity: string;
  notional: string;
  cumulative: boolean;
  priceMode: FillPriceMode;
  symbol: string;
  side: "buy" | "sell";
  sourceTime?: number;
  sourceSeq?: number;
  status?: string;
}
export interface OrderFillInput {
  quantity?: unknown;
  price?: unknown;
  cumulative?: unknown;
  priceMode?: unknown;
  cumulativeQuantity?: unknown;
  cumulativeNotional?: unknown;
  lastExecutionQty?: unknown;
  executionId?: string;
  executionSeen?: boolean;
  symbol: string;
  side: "buy" | "sell";
  sourceTime?: number;
  sourceSeq?: number;
  fee?: unknown;
  feeAsset?: string;
  coverageComplete?: boolean;
}
export type OrderFillDecision =
  | { kind: "accepted"; deltaQty: string; deltaNotional: string; executionPrice: number; fee: string; checkpoint: OrderFillCheckpoint }
  | { kind: "status_only" | "duplicate" | "stale" }
  | { kind: "invalid" | "reconciliation_required"; reason: string };

export function parseCumulativeFilledQty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (value === true || value === false) return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  throw new Error("cumulativeFilledQty must resolve to true or false");
}

/** Pure: no receipts or checkpoints advance until the complete decision is committed. */
export function normalizeOrderFill(input: OrderFillInput, previous?: OrderFillCheckpoint): OrderFillDecision {
  const reconcile = (reason: string): OrderFillDecision => ({ kind: "reconciliation_required", reason });
  try {
    const cumulative = parseCumulativeFilledQty(input.cumulative);
    const priceMode = input.priceMode ?? "execution";
    if (priceMode !== "execution" && priceMode !== "cumulative_average") throw new Error("Invalid fillPriceMode");
    if (previous && (previous.symbol !== input.symbol || previous.side !== input.side)) return reconcile("Order instrument or side changed");
    if (previous && FillDecimal.from(previous.quantity).units > 0n && (previous.cumulative !== cumulative || previous.priceMode !== priceMode)) return reconcile("Fill interpretation changed mid-order");
    if (input.quantity == null || input.quantity === "") return { kind: "status_only" };
    const zero = FillDecimal.from(0);
    const q = FillDecimal.from(input.quantity);
    const prevQ = FillDecimal.from(previous?.quantity ?? 0);
    const prevN = FillDecimal.from(previous?.notional ?? 0);
    if (q.cmp(zero) < 0) throw new Error("Filled quantity must be nonnegative");
    const total = cumulative ? q : input.cumulativeQuantity == null ? prevQ.add(q) : FillDecimal.from(input.cumulativeQuantity);
    if ((cumulative || input.cumulativeQuantity != null) && total.cmp(prevQ) < 0) return { kind: "stale" };
    // Incremental replay must not recompute a new total from an already accepted execution.
    if (!cumulative && input.executionSeen) return { kind: "duplicate" };
    const delta = total.sub(prevQ);
    let notional: FillDecimal | undefined;
    if (priceMode === "cumulative_average" && (input.cumulativeNotional != null || (input.price != null && input.price !== ""))) {
      if (!cumulative && input.cumulativeQuantity == null && !input.coverageComplete) return reconcile("Cumulative price requires mapped cumulative quantity or proven event coverage");
      const priceQuantity = input.cumulativeQuantity == null ? total : FillDecimal.from(input.cumulativeQuantity);
      if (priceQuantity.cmp(total) !== 0) return reconcile("Incremental and cumulative quantity disagree");
      notional = input.cumulativeNotional == null ? priceQuantity.mul(FillDecimal.from(input.price)) : FillDecimal.from(input.cumulativeNotional);
    }
    if (delta.cmp(zero) === 0) {
      if (notional && notional.cmp(prevN) !== 0) return reconcile("Equal quantity with changed notional is a correction");
      if (FillDecimal.from(input.fee ?? 0).cmp(zero) > 0 && !input.executionSeen) return reconcile("Late fee requires a separately reconciled adjustment");
      return { kind: q.cmp(zero) === 0 ? "status_only" : "duplicate" };
    }
    if (input.executionSeen) return reconcile("Execution identity reused with increased quantity");
    if (!cumulative && delta.cmp(q) !== 0) return reconcile("Incremental execution does not cover cumulative progress");
    if (!cumulative && !input.executionId && input.cumulativeQuantity == null) return reconcile("Incremental fill needs a broker execution identity or cumulative progress");
    if (input.cumulativeQuantity != null && FillDecimal.from(input.cumulativeQuantity).cmp(total) !== 0) return reconcile("Execution gap or cumulative quantity mismatch");
    if (previous?.sourceTime && input.sourceTime && input.sourceTime < previous.sourceTime) return reconcile("Late execution requires chronological replay");
    if (previous?.sourceSeq && input.sourceSeq && input.sourceSeq <= previous.sourceSeq) return reconcile("Unprocessed fill has stale source sequence");
    if (previous?.status && ["canceled", "cancelled", "expired", "rejected", "filled"].includes(previous.status)) return reconcile("Fill after terminal lifecycle requires broker reconciliation");
    if (priceMode === "execution") {
      const price = FillDecimal.from(input.price);
      if (price.cmp(zero) <= 0) throw new Error("Positive fill requires a positive price");
      if (cumulative && (!input.lastExecutionQty || FillDecimal.from(input.lastExecutionQty).cmp(delta) !== 0)) return reconcile("Execution price does not prove coverage of the cumulative increase");
      notional = prevN.add(delta.mul(price));
    }
    if (!notional) return reconcile("Missing cumulative price/notional");
    const deltaNotional = notional.sub(prevN);
    if (deltaNotional.cmp(zero) <= 0) return reconcile("Nonpositive notional increase");
    const fee = FillDecimal.from(input.fee ?? 0);
    if (fee.cmp(zero) < 0) throw new Error("Fee must be nonnegative");
    if (cumulative && !input.coverageComplete && (input.lastExecutionQty == null || FillDecimal.from(input.lastExecutionQty).cmp(delta) !== 0)) return reconcile("Cumulative catch-up requires complete executions and fee coverage");
    const executionPrice = deltaNotional.toNumber() / delta.toNumber();
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) throw new Error("Invalid execution price");
    return { kind: "accepted", deltaQty: delta.toString(), deltaNotional: deltaNotional.toString(), executionPrice, fee: fee.toString(), checkpoint: {
      quantity: total.toString(), notional: notional.toString(), cumulative, priceMode,
      symbol: input.symbol, side: input.side, sourceTime: input.sourceTime, sourceSeq: input.sourceSeq,
    } };
  } catch (error) {
    return { kind: "invalid", reason: (error as Error).message };
  }
}
