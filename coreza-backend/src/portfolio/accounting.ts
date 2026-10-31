import { createHash } from "crypto";
import { decimal, allocateOpenAmount } from "./decimal";

export type AccountingStatus = "initializing" | "ready" | "recovering" | "reconciliation_required" | "unsupported_model" | "stopped";
export type QuantityMode = "incremental" | "cumulative";
export type PriceMode = "execution" | "cumulative_vwap";
export type FeeMode = "incremental" | "cumulative";
export interface BookScope {
  userId: string;
  workflowId: string;
  activationId: string;
  broker: string;
  environment: string;
  accountId: string;
  credentialId: string;
  accountModel: "long_only_cash";
  currency: string;
}
export interface AccountingPosition {
  quantity: string;
  grossCost: string;
  entryFees: string;
  realized: string;
  mark: string;
  entryOrderId: string;
  entryTime: string;
}
export interface OrderProgress {
  symbol: string;
  side: "buy" | "sell";
  quantityMode: QuantityMode;
  priceMode: PriceMode;
  feeMode: FeeMode;
  quantity: string;
  notional: string;
  fees: string;
  status: string;
}
export interface AccountingBook {
  version: 2;
  scope: BookScope;
  revision: number;
  cash: string;
  startingCash: string;
  fees: string;
  realized: string;
  realizedBySymbol: Record<string, string>;
  positions: Record<string, AccountingPosition>;
  orders: Record<string, OrderProgress>;
}
export interface AccountingEvent {
  kind: "execution" | "order_status" | "cash_movement" | "corporate_action" | "correction";
  orderId: string;
  executionId?: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  price?: string;
  quoteNotional?: string;
  fee: string;
  feeAsset: string;
  quantityMode: QuantityMode;
  priceMode: PriceMode;
  feeMode: FeeMode;
  status: string;
  timestamp: string;
  accountPosition?: string;
}
export interface AcceptedExecution {
  symbol: string;
  side: "buy" | "sell";
  orderId: string;
  timestamp: string;
  id: string;
  fingerprint: string;
  quantity: string;
  notional: string;
  price: string;
  fee: string;
  grossRealized: string;
  netRealized: string;
  allocatedEntryFee: string;
  positionBefore?: AccountingPosition;
}
export interface AccountingTransition {
  book: AccountingBook;
  execution?: AcceptedExecution;
  reason?: string;
}

const rank: Record<string, number> = { new: 10, accepted: 10, pending_new: 10, partially_filled: 20, pending_cancel: 25, filled: 30, finished: 30, canceled: 40, cancelled: 40, rejected: 40, expired: 40 };
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bookKey = (scope: BookScope): string => hash([scope.userId, scope.workflowId, scope.activationId, scope.broker, scope.environment, scope.accountId, scope.accountModel, scope.currency]);
export const eventFingerprint = (event: AccountingEvent): string => hash([event.kind, event.orderId, event.symbol, event.side,
  decimal(event.quantity).toString(), event.price == null ? null : decimal(event.price).toString(),
  event.quoteNotional == null ? null : decimal(event.quoteNotional).toString(), decimal(event.fee).toString(),
  event.feeAsset, event.quantityMode, event.priceMode, event.feeMode]);
export const lifecycleEvent = (event: AccountingEvent): AccountingEvent => ({ ...event, kind: "order_status", executionId: undefined,
  quantity: "0", fee: "0", price: undefined, quoteNotional: undefined, accountPosition: undefined });
export const lifecycleEventKey = (book: AccountingBook, event: AccountingEvent): string => hash([bookKey(book.scope), "status", event.orderId, event.symbol, event.status]);
export function eventKey(book: AccountingBook, event: AccountingEvent): string | undefined {
  const id = event.executionId?.trim();
  if (id && id !== "-1" && id !== "0") return hash([bookKey(book.scope), event.symbol, event.orderId, id]);
  if (event.quantityMode === "cumulative") return hash([bookKey(book.scope), event.symbol, event.orderId, "cumulative", decimal(event.quantity).toString(), event.feeMode === "cumulative" ? decimal(event.fee).toString() : ""]);
  return undefined;
}
export function createBook(scope: BookScope, cash: string): AccountingBook {
  for (const field of ["userId", "workflowId", "activationId", "broker", "environment", "accountId", "credentialId", "accountModel", "currency"] as const) {
    const value = scope[field];
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256) throw new Error("Complete non-secret accounting scope is required");
  }
  if (scope.accountModel !== "long_only_cash" || decimal(cash).compare(0) < 0) throw new Error("Unsupported accounting allocation/model");
  // Validate compatibility range before any durable write.
  decimal(cash).toNumber();
  return { version: 2, scope: { ...scope }, revision: 0, cash: decimal(cash).toString(), startingCash: decimal(cash).toString(), fees: "0", realized: "0", realizedBySymbol: {}, positions: {}, orders: {} };
}

/** Pure candidate calculation. Durable identity checks and publication surround this reducer.
 * Quote-currency fees/rebates only; other assets require an explicit adapter/FX source. */
export function reduceAccountingEvent(book: AccountingBook, event: AccountingEvent): AccountingTransition {
  if (book.version !== 2) throw new Error("Unsupported calculation version");
  if (!Number.isSafeInteger(book.revision) || book.revision < 0 || book.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Accounting revision exceeds supported range");
  if (!["execution", "order_status"].includes(event.kind)) throw new Error("reconciliation_required: non-fill economic event");
  if (!event.orderId || !event.symbol || !["buy", "sell"].includes(event.side) || !Number.isFinite(Date.parse(event.timestamp))) throw new Error("Invalid execution identity/side/time");
  if (!["incremental", "cumulative"].includes(event.quantityMode) || !["execution", "cumulative_vwap"].includes(event.priceMode) || !["incremental", "cumulative"].includes(event.feeMode)) throw new Error("Explicit quantity, price and fee modes required");
  if (event.priceMode === "cumulative_vwap" && event.quantityMode !== "cumulative") throw new Error("Cumulative VWAP requires cumulative quantity");
  const totalQty = decimal(event.quantity), totalFee = decimal(event.fee);
  if (totalQty.compare(0) < 0) throw new Error("Negative execution quantity");
  if (event.kind === "order_status" && (totalQty.compare(0) !== 0 || totalFee.compare(0) !== 0)) throw new Error("Lifecycle events cannot contain economic changes");
  const prev = Object.hasOwn(book.orders, event.orderId) ? book.orders[event.orderId] : undefined;
  if (prev && (prev.symbol !== event.symbol || prev.side !== event.side || prev.quantityMode !== event.quantityMode || prev.priceMode !== event.priceMode || prev.feeMode !== event.feeMode)) throw new Error("reconciliation_required: order interpretation changed");
  if (!prev && Object.keys(book.orders).length >= 10_000) throw new Error("reconciliation_required: open book order coverage limit reached");
  const priorQty = decimal(prev?.quantity ?? "0"), priorNotional = decimal(prev?.notional ?? "0"), priorFees = decimal(prev?.fees ?? "0");
  const quantity = event.kind === "order_status" ? decimal(0) : event.quantityMode === "cumulative" ? totalQty.sub(priorQty) : totalQty;
  if (quantity.compare(0) < 0) return { book, reason: "stale_cumulative_quantity" };
  const fee = event.kind === "order_status" ? decimal(0) : event.feeMode === "cumulative" ? totalFee.sub(priorFees) : totalFee;
  if (fee.compare(0) !== 0 && event.feeAsset !== book.scope.currency) throw new Error("unsupported_model: native fee asset/FX adapter required");
  let notional = decimal(0), price = decimal(0);
  if (quantity.compare(0) > 0) {
    if (event.price == null || decimal(event.price).compare(0) <= 0) throw new Error("Missing positive execution price");
    if (event.quantityMode === "cumulative" && event.priceMode === "cumulative_vwap") {
      const totalNotional = event.quoteNotional == null ? totalQty.mul(event.price) : decimal(event.quoteNotional);
      notional = totalNotional.sub(priorNotional);
    } else {
      notional = event.quoteNotional == null ? quantity.mul(event.price) : event.quantityMode === "cumulative" ? decimal(event.quoteNotional).sub(priorNotional) : decimal(event.quoteNotional);
    }
    if (notional.compare(0) <= 0) throw new Error("reconciliation_required: nonpositive execution notional");
    price = notional.div(quantity);
  } else if (event.kind === "execution" && event.quantityMode === "cumulative") {
    const cumulativeNotional = event.quoteNotional == null
      ? event.priceMode === "cumulative_vwap" && event.price != null ? totalQty.mul(event.price) : undefined
      : decimal(event.quoteNotional);
    if (cumulativeNotional && cumulativeNotional.compare(priorNotional) !== 0) throw new Error("reconciliation_required: notional changed without quantity");
  }
  const status = !prev || (rank[event.status] ?? 0) >= (rank[prev.status] ?? 0) ? event.status : prev.status;
  const economic = quantity.compare(0) > 0 || fee.compare(0) !== 0;
  if (!economic && prev && status === prev.status) return { book, reason: "no_economic_change" };
  const id = economic ? eventKey(book, event) : undefined;
  if (economic && !id) throw new Error("reconciliation_required: stable broker execution ID required for incremental input");
  const before = Object.hasOwn(book.positions, event.symbol) ? book.positions[event.symbol] : undefined;
  const openQty = decimal(before?.quantity ?? "0");
  const nextQty = event.side === "buy" ? openQty.add(quantity) : openQty.sub(quantity);
  if (nextQty.compare(0) < 0) throw new Error("unsupported_model: broker execution exceeds attributed long quantity");
  // Account-wide snapshots are only comparisons, never strategy allocation updates.
  if (event.accountPosition != null && decimal(event.accountPosition).compare(nextQty) !== 0) throw new Error("reconciliation_required: account position differs from exclusive attributed position");
  let grossCost = decimal(before?.grossCost ?? "0"), entryFees = decimal(before?.entryFees ?? "0");
  let grossRealized = decimal(0), allocatedEntryFee = decimal(0), netRealized = decimal(0);
  if (quantity.compare(0) > 0) {
    if (event.side === "buy") { grossCost = grossCost.add(notional); entryFees = entryFees.add(fee); }
    else {
      const allocatedCost = decimal(allocateOpenAmount(grossCost.toString(), quantity.toString(), openQty.toString()));
      allocatedEntryFee = decimal(allocateOpenAmount(entryFees.toString(), quantity.toString(), openQty.toString()));
      grossCost = grossCost.sub(allocatedCost); entryFees = entryFees.sub(allocatedEntryFee);
      grossRealized = notional.sub(allocatedCost); netRealized = grossRealized.sub(allocatedEntryFee).sub(fee);
    }
  } else if (fee.compare(0) !== 0) {
    // An adjustment needs allocation evidence; do not guess whether it belongs to open/closed lots.
    throw new Error("reconciliation_required: fee-only adjustment requires correction evidence");
  }
  const cash = decimal(book.cash).add(event.side === "buy" ? notional.neg() : notional).sub(fee);
  if (cash.compare(0) < 0) throw new Error("reconciliation_required: negative cash in unleveraged allocation");
  const positions = { ...book.positions };
  if (nextQty.compare(0) === 0) delete positions[event.symbol];
  else positions[event.symbol] = { quantity: nextQty.toString(), grossCost: grossCost.toString(), entryFees: entryFees.toString(), realized: decimal(before?.realized ?? "0").add(netRealized).toString(), mark: economic ? price.toString() : before!.mark, entryOrderId: before?.entryOrderId ?? event.orderId, entryTime: before?.entryTime ?? event.timestamp };
  const next: AccountingBook = {
    ...book, revision: book.revision + 1, cash: cash.toString(), positions,
    fees: decimal(book.fees).add(fee).toString(), realized: decimal(book.realized).add(netRealized).toString(),
    realizedBySymbol: { ...book.realizedBySymbol, [event.symbol]: decimal(book.realizedBySymbol[event.symbol] ?? "0").add(netRealized).toString() },
    orders: { ...book.orders, [event.orderId]: { symbol: event.symbol, side: event.side, quantityMode: event.quantityMode, priceMode: event.priceMode, feeMode: event.feeMode, quantity: priorQty.add(quantity).toString(), notional: priorNotional.add(notional).toString(), fees: priorFees.add(fee).toString(), status } },
  };
  // All compatibility conversions must succeed before the candidate can be accepted.
  for (const value of [next.cash, next.fees, next.realized, nextQty.toString(), grossCost.toString(), price.toString(), netRealized.toString()]) decimal(value).toNumber();
  return { book: next, execution: economic ? { symbol: event.symbol, side: event.side, orderId: event.orderId, timestamp: event.timestamp, id: id!, fingerprint: eventFingerprint(event), quantity: quantity.toString(), notional: notional.toString(), price: price.toString(), fee: fee.toString(), grossRealized: grossRealized.toString(), netRealized: netRealized.toString(), allocatedEntryFee: allocatedEntryFee.toString(), positionBefore: before ? { ...before } : undefined } : undefined };
}
