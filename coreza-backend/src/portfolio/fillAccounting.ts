import { decimal, allocateOpenAmount } from "./decimal";
import type { PositionReconciliation, reconcilePosition } from "./positionReconciliation";

/** Broker-supplied policy; all hooks are synchronous and must not mutate state. */
export interface FillAccountingPolicy {
  baseAssetFees?: boolean;
  resolveFeeAsset: (input: FillInput & { feeAsset?: string }, context: { baseAsset?: string; currency: string; previousFeeAsset?: string }) => string;
  validateFill: (context: { input: FillInput & { timestamp: string }; quantity: string; feeAsset: string; previousFeeAsset?: string;
    previousFees: string; previousTimestamp?: string; staleSequence: boolean; identity?: string }) => void;
  reconcilePosition: (input: Parameters<typeof reconcilePosition>[0], previous?: PositionReconciliation) => PositionReconciliation;
}

export interface FillProgress {
  quantity: string;
  notional: string;
  fees: string;
  cumulative: boolean;
}
export interface FillInput {
  quantity?: string | number;
  price?: string | number;
  fee?: string | number;
  cumulative: boolean;
}
export interface OpenCost {
  quantity: string;
  cost: string;
  entryFees: string;
  realized: string;
  entryOrderId: string;
  entryTime: string;
}

/** Independent of order progress so a replay is identified before any mutation. */
export function fillFingerprint(input: FillInput, side: string, feeAsset: string): string {
  return JSON.stringify([side, decimal(input.quantity ?? 0).toString(), input.price == null ? null : decimal(input.price).toString(),
    decimal(input.fee ?? 0).toString(),
    feeAsset, input.cumulative]);
}

/** Normalize only the affected order. No I/O, full-book copies or history scans. */
export function normalizeFill(input: FillInput, previous?: FillProgress) {
  if (typeof input.cumulative !== "boolean") throw new Error("Cumulative fill setting must be a checkbox value");
  if (previous && previous.cumulative !== input.cumulative) throw new Error("Cannot change fill interpretation for an existing order");
  const previousQty = decimal(previous?.quantity ?? 0);
  const total = decimal(input.quantity ?? (input.cumulative ? previousQty : 0));
  if (total.compare(0) < 0) throw new Error("Filled quantity must not be negative");
  const quantity = input.cumulative ? total.sub(previousQty) : total;
  const previousFees = decimal(previous?.fees ?? 0);
  const fees = decimal(input.fee ?? (input.cumulative ? previousFees : 0));
  const fee = input.cumulative ? fees.sub(previousFees) : fees;
  const previousNotional = decimal(previous?.notional ?? 0);
  if (quantity.compare(0) < 0) return { quantity: "0", price: "0", notional: "0", fee: "0", progress: previous!, reason: "stale_cumulative_quantity" };
  let notional = decimal(0), price = decimal(0);
  if (quantity.compare(0) > 0) {
    if (input.price == null || decimal(input.price).compare(0) <= 0) throw new Error("Positive fill price is required");
    notional = input.cumulative ? total.mul(input.price).sub(previousNotional) : quantity.mul(input.price);
    if (notional.compare(0) <= 0) throw new Error("Fill notional must be positive");
    price = notional.div(quantity);
  } else {
    // Missing quantity on a lifecycle message is different from a supplied total.
    if (input.cumulative && input.price != null && input.quantity != null && total.mul(input.price).compare(previousNotional) !== 0) throw new Error("Cumulative average changed without an execution quantity");
    if (fee.compare(0) !== 0) throw new Error("Fee-only adjustment requires an explicit accounting treatment");
  }
  const progress: FillProgress = { cumulative: input.cumulative,
    quantity: previousQty.add(quantity).toString(), notional: previousNotional.add(notional).toString(), fees: previousFees.add(fee).toString() };
  return { quantity: quantity.toString(), price: price.toString(), notional: notional.toString(), fee: fee.toString(), progress, reason: undefined as string | undefined };
}

/** Long-only quote-currency accounting for one position. Final closes allocate
 * all remaining basis and entry fees, including division residue. */
export function calculatePositionFill(previous: OpenCost | undefined, side: "buy" | "sell", quantity: string,
  notional: string, fee: string, orderId: string, timestamp: string) {
  const oldQty = decimal(previous?.quantity ?? 0), qty = decimal(quantity);
  if (oldQty.compare(0) < 0) throw new Error("Short-position accounting requires its own instrument model");
  const nextQty = side === "buy" ? oldQty.add(qty) : oldQty.sub(qty);
  if (nextQty.compare(0) < 0) throw new Error("Sell execution exceeds the held long quantity");
  let cost = decimal(previous?.cost ?? 0), entryFees = decimal(previous?.entryFees ?? 0);
  let gross = decimal(0), allocatedFee = decimal(0), realized = decimal(0);
  if (side === "buy") { cost = cost.add(notional); entryFees = entryFees.add(fee); }
  else {
    const allocatedCost = decimal(allocateOpenAmount(cost.toString(), quantity, oldQty.toString()));
    allocatedFee = decimal(allocateOpenAmount(entryFees.toString(), quantity, oldQty.toString()));
    cost = cost.sub(allocatedCost); entryFees = entryFees.sub(allocatedFee);
    gross = decimal(notional).sub(allocatedCost); realized = gross.sub(allocatedFee).sub(fee);
  }
  const position: OpenCost | undefined = nextQty.compare(0) === 0 ? undefined : {
    quantity: nextQty.toString(), cost: cost.toString(), entryFees: entryFees.toString(),
    realized: decimal(previous?.realized ?? 0).add(realized).toString(),
    entryOrderId: previous?.entryOrderId ?? orderId, entryTime: previous?.entryTime ?? timestamp,
  };
  return { position, gross: gross.toString(), realized: realized.toString(), allocatedFee: allocatedFee.toString() };
}
