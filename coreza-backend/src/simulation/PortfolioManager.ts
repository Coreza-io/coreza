/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { randomUUID } from "crypto";
import { decimal } from "../portfolio/decimal";
import { FillInput, FillProgress, OpenCost, normalizeFill, calculatePositionFill, fillFingerprint } from "../portfolio/fillAccounting";
import { finished } from "stream";
import { Position, Trade } from "../backtest/simBroker/interfaces";
import {
  Order,
  OrderType,
  OrderSide,
  OrderStatus,
  OrderEvent,
  OrderTicket,
  isTicketPending,
} from "../types/order";
import {
  PositionQueryPayload,
  shapePositionQuery,
} from "../utils/portfolioHelpers";

// ============== NEW INTERFACES (portfolio state model) ==============

export interface OrderState {
  orderId?: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType?: string;
  timeInForce?: string;
  status: string;
  origQty: number | undefined;
  filledQty: number;
  remainingQty?: number | undefined;
  avgFillPrice?: number | undefined;
  totalFees: number; // Quote-currency fees only.
  baseFeeQty?: number;
  feeAsset?: string;
  stopPrice?: number | undefined;
  limitPrice?: number | undefined;
  trailPercent?: number | undefined;
  trailPrice?: number | undefined;
  lastSeq?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlgoOrderState {
  algoId: string;
  orderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  status: string;
  stopPrice?: number | undefined;
  limitPrice?: number | undefined;
  trailPercent?: number | undefined;
  trailPrice?: number | undefined;
  origQty: number | undefined;
  rejectReason?: string;
  timeInForce: string;
  lastSeq?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  executionId: string;
  orderId?: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  execQty: number;
  execPrice: number;
  quoteNotional?: number;
  feeAmount: number;
  feeAsset?: string;
  filledQty?: number;
  ts: string;
}

export interface PositionState {
  symbol: string;
  quantity: number;
  side: string;
  currentPrice: number;
  avgFillPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openCostBasis: number;
  //updatedAt: string;
}

export interface PendingClosingTrade {
  key: string;
  tradeId: string;
  symbol: string;
  side: "buy" | "sell";
  entryOrderId: string;
  exitOrderId: string;
  entryPrice: number;
  weightedExitPrice: number;
  accumulatedQuantity: number;
  accumulatedGrossPnl: number;
  accumulatedCommission: number;
  entryTime: string;
  latestExitTime: string;
  status: string;
}

export type ApplyTradeResult =
  | { kind: "skipped"; reason: string }
  | { kind: "pendingUpdate"; pending: PendingClosingTrade }
  | { kind: "finalized"; trade: Trade };

type BalanceState = {
  asset: string;
  cash: number;
  equity: number;
  margin: number; // multiplier: 1 | 2 | 4
  initialMargin?: number;
  buyingPower?: number;
  locked?: number;
  updatedAt: string;
};

// ============== LEGACY INTERFACES ==============

export interface SpotHolding {
  symbol: string;
  quantity: number;
  avgFillPrice: number;
  realizedPnl: number;
  currentPrice: number;
}

export interface PortfolioSnapshot {
  cash: Record<string, number>; // asset -> balance
  holdings: Record<string, SpotHolding>; // symbol -> holding
  trades: Trade[];
  totalValueUsdt: number;
}

// ============== CONSTANTS ==============

const MAX_FILL_LEDGER_SIZE = 10_000;

const ORDER_STATUS_RANK: Record<string, number> = {
  pending_new: 10,
  accepted: 15,
  submitted: 20,
  open: 20,
  new: 20,
  New: 20,
  replaced: 50,
  pending_replace: 25,
  partially_filled: 30,
  pending_cancel: 35,
  filled: 40,
  finished: 40,
  canceled: 50,
  cancelled: 50,
  expired: 50,
  rejected: 50,
  stopped: 50,
  suspended: 50,
  done_for_day: 50,
};

const ALGO_STATUS_RANK: Record<string, number> = {
  untriggered: 0,
  new: 1,
  triggering: 2,
  triggered: 3,
  partially_filled: 4,
  filled: 5,
  finished: 5,
  canceled: 6,
  rejected: 6,
  expired: 6,
};

const OPEN_ORDER_STATUSES = new Set([
  "NEW",
  "new",
  "pending_new",
  "accepted",
  "open",
  "partially_filled",
  "pending_cancel",
  "pending_replace",
]);

const OPEN_ALGO_ORDER_STATUSES = new Set(["new", "triggering"]);

const TERMINAL_ORDER_STATUSES = new Set([
  "filled",
  "finished",
  "canceled",
  "cancelled",
  "rejected",
  "expired",
  "replaced",
  "stopped",
  "suspended",
  "done_for_day",
]);

// ============== PORTFOLIO MANAGER ==============

/**
 * PortfolioManager - Pure in-memory portfolio engine for live broker mode.
 *
 * All state (fills, holdings, PnL, pending orders) lives in RAM only,
 * scoped to the workflow run. When the workflow ends, destroy() is called
 * and all state is garbage collected.
 *
 * portfolio model: Separate order lifecycle, execution accounting, position reconciliation, and balance reconciliation.
 *
 * One instance per (userId, executionId) pair, managed via static cache.
 */
export class PortfolioManager {
  private static retirementTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static instances = new Map<string, PortfolioManager>();
  private static readonly SYMBOL_QUOTE_SUFFIXES = [
    "USDT",
    "USDC",
    "BUSD",
    "FDUSD",
  ];

  private userId: string;
  private executionId: string;

  // ============== portfolio STATE MAPS ==============
  private orders = new Map<string, OrderState>();
  private algoOrders = new Map<string, AlgoOrderState>();
  private executions = new Map<string, ExecutionRecord>();
  private balances = new Map<string, BalanceState>();
  private positions = new Map<string, PositionState>();
  private executionKeysSeen = new Set<string>();
  private static readonly MAX_EXECUTION_KEYS = 50_000;
  private clientOrderIdIndex = new Map<string, string>(); // clientOrderId → orderId

  // ============== LEGACY STATE (kept for migration) ==============
  private cashBook = new Map<string, number>(); // asset -> total balance
  private holdings = new Map<string, SpotHolding>(); // symbol -> holding
  private fillLedger: OrderEvent[] = [];
  private orderCumQtyMap = new Map<string, number>(); // orderId → cumulative qty applied (partial fill tracking)
  private trades: Trade[] = [];
  private pendingClosingTrades = new Map<string, PendingClosingTrade>();
  private currentEntryMap = new Map<
    string,
    {
      fillId: string;
      entryTime: string;
    }
  >();
  private peakEquity = 0;
  private startingEquity: number | null = null;

  private bootstrapped = false;
  private fillProgress = new Map<string, FillProgress>();
  private acceptedFills = new Map<string, string>();
  private openCosts = new Map<string, OpenCost>();
  private exactCash = new Map<string, string>();
  private positionScopes = new Map<string, string>();
  private orderScopes = new Map<string, string>();
  private accountScope?: string;
  private positionMarkTimes = new Map<string, number>();
  private fillTotalsActive = false;
  private realizedTotalExact = "0";
  private feesTotalExact = "0";
  private realizedTotal = 0;
  private feesTotal = 0;
  private nativeFees = new Map<string, string>();
  private orderFeeAssets = new Map<string, string>();
  private realizedBySymbol = new Map<string, { exact: string; value: number }>();

  /** One synchronous, validated transition. Only touched records are replaced. */
  applyOrderEvent(input: FillInput & {
    orderId: string; clientOrderId?: string; symbol: string; side?: "buy" | "sell";
    status?: string; origQty?: number; orderType?: string; timeInForce?: string;
    limitPrice?: number; stopPrice?: number; trailPercent?: number; trailPrice?: number;
    executionId?: string; sequence?: number; scope: string; feeAsset?: string;
    baseCurrency: string; timestamp: string; positionQty?: number;
  }): { quantity: number; price: number; fee: number; notional: number; trade?: Trade; reason?: string; netPositionDelta?: number; baseFeeQty?: number; feeAsset?: string } {
    const previousOrder = this.orders.get(input.orderId);
    const side = input.side ?? previousOrder?.side;
    if (!side || !["buy", "sell"].includes(side) || !input.symbol || !Number.isFinite(Date.parse(input.timestamp))) throw new Error("Valid symbol, side and timestamp are required");
    if (previousOrder && (previousOrder.symbol !== input.symbol || previousOrder.side !== side)) throw new Error("Order symbol/side mismatch");
    if (this.orderScopes.has(input.orderId) && this.orderScopes.get(input.orderId) !== input.scope) throw new Error("Order account scope mismatch");
    const progressKey = JSON.stringify([input.scope, input.symbol, input.orderId]);
    const { baseAsset, quoteAsset } = this.parseInstrument(input.symbol, input.baseCurrency);
    const currency = quoteAsset ?? input.baseCurrency;
    const previousFeeAsset = this.orderFeeAssets.get(input.orderId);
    const feeAsset = input.feeAsset || previousFeeAsset || currency;
    if (previousFeeAsset === baseAsset && input.fee != null && decimal(input.fee).compare(0) !== 0 && !input.feeAsset) {
      throw new Error("A supplied fee requires an explicit asset after a base-asset fee");
    }
    const baseFee = feeAsset === baseAsset && baseAsset !== currency;
    if (currency !== input.baseCurrency) throw new Error("Cross-currency fill valuation requires an FX treatment");
    const rawQuantity = decimal(input.quantity ?? 0);
    const economicInput = rawQuantity.compare(0) > 0 || decimal(input.fee ?? 0).compare(0) !== 0;
    const trimmedId = input.executionId?.trim();
    const nativeId = trimmedId && trimmedId !== "-1" ? trimmedId : undefined;
    if (input.sequence != null && (!Number.isSafeInteger(input.sequence) || input.sequence < 0)) throw new Error("Execution sequence must be a nonnegative safe integer");
    const sequence = input.sequence != null && input.sequence > 0 ? input.sequence : undefined;
    // Cumulative snapshots are identified by accepted order progress. Some
    // brokers reuse an exchange order ID in their executionId field.
    const identity = !input.cumulative && economicInput && (nativeId || sequence != null) ? JSON.stringify([progressKey, nativeId ?? `seq:${sequence}`]) : undefined;
    const fingerprint = identity ? fillFingerprint(input, side, feeAsset) : undefined;
    const existingFingerprint = identity ? this.acceptedFills.get(identity) : undefined;
    if (existingFingerprint && existingFingerprint !== fingerprint) throw new Error("Conflicting execution identity");
    const duplicate = existingFingerprint !== undefined;
    const priorProgress = this.fillProgress.get(progressKey);
    const baseline = priorProgress ?? (previousOrder && previousOrder.filledQty > 0 ? {
      quantity: String(previousOrder.filledQty), notional: decimal(previousOrder.filledQty).mul(previousOrder.avgFillPrice ?? 0).toString(),
      fees: String(previousOrder.totalFees), cumulative: input.cumulative,
    } : undefined);
    const fill = duplicate ? { quantity: "0", price: "0", notional: "0", fee: "0", progress: baseline, reason: "duplicate_execution" }
      : normalizeFill(input, baseline);
    const quantity = decimal(fill.quantity).toNumber(), price = decimal(fill.price).toNumber(), fee = decimal(fill.fee).toNumber();
    const notional = decimal(fill.notional).toNumber();
    if (quantity > 0 && previousFeeAsset && previousFeeAsset !== feeAsset && decimal(baseline?.fees ?? 0).compare(0) !== 0) {
      throw new Error("Mixed fee assets for one order require explicit reconciliation");
    }
    const quoteFee = baseFee ? "0" : fill.fee;
    const staleSequence = input.sequence != null && previousOrder?.lastSeq != null && input.sequence <= previousOrder.lastSeq;
    const incomingStatus = String(input.status ?? previousOrder?.status ?? "new").trim().toLowerCase();
    const status = previousOrder && (staleSequence || (ORDER_STATUS_RANK[incomingStatus] ?? 0) < (ORDER_STATUS_RANK[previousOrder.status] ?? 0)) ? previousOrder.status : incomingStatus;
    const progress = fill.progress;
    const filledQty = progress ? decimal(progress.quantity).toNumber() : previousOrder?.filledQty ?? 0;
    const origQty = input.origQty ?? previousOrder?.origQty;
    if (origQty != null && (!Number.isFinite(origQty) || origQty < 0 || decimal(origQty).compare(filledQty) < 0)) throw new Error("Invalid original order quantity");
    const nextOrder: OrderState = { ...previousOrder, orderId: input.orderId, clientOrderId: input.clientOrderId ?? previousOrder?.clientOrderId,
      symbol: input.symbol, side, status, origQty, filledQty,
      remainingQty: origQty == null ? undefined : decimal(origQty).sub(filledQty).toNumber(),
      avgFillPrice: progress && decimal(progress.quantity).compare(0) > 0 ? decimal(progress.notional).div(progress.quantity).toNumber() : previousOrder?.avgFillPrice,
      totalFees: baseFee || (quantity === 0 && previousFeeAsset === baseAsset) ? previousOrder?.totalFees ?? 0 : progress ? decimal(progress.fees).toNumber() : previousOrder?.totalFees ?? 0,
      ...(baseFee && quantity > 0 ? { baseFeeQty: decimal(progress?.fees ?? 0).toNumber(), feeAsset } : {}),
      orderType: input.orderType ?? previousOrder?.orderType, timeInForce: input.timeInForce ?? previousOrder?.timeInForce,
      limitPrice: input.limitPrice ?? previousOrder?.limitPrice, stopPrice: input.stopPrice ?? previousOrder?.stopPrice,
      trailPercent: input.trailPercent ?? previousOrder?.trailPercent, trailPrice: input.trailPrice ?? previousOrder?.trailPrice,
      lastSeq: staleSequence ? previousOrder?.lastSeq : input.sequence ?? previousOrder?.lastSeq,
      createdAt: previousOrder?.createdAt ?? input.timestamp, updatedAt: input.timestamp };
    if (origQty != null && origQty > 0 && filledQty >= origQty && !TERMINAL_ORDER_STATUSES.has(nextOrder.status)) nextOrder.status = "filled";
    if (quantity === 0) {
      const pending = this.pendingClosingTrades.get(input.orderId);
      const trade = pending && TERMINAL_ORDER_STATUSES.has(nextOrder.status) ? this.closedTrade(pending) : undefined;
      this.orders.set(input.orderId, nextOrder);
      if (input.clientOrderId) this.clientOrderIdIndex.set(input.clientOrderId, input.orderId);
      this.orderScopes.set(input.orderId, input.scope);
      if (trade) { this.trades.push(trade); this.pendingClosingTrades.delete(input.orderId); }
      return { quantity, price, fee, notional, trade, reason: fill.reason ?? "no_execution" };
    }
    if (identity && !duplicate && this.acceptedFills.size >= PortfolioManager.MAX_EXECUTION_KEYS) throw new Error("Execution identity capacity reached; start a new activation");
    if (this.accountScope != null && this.accountScope !== input.scope) throw new Error("Portfolio account scope mismatch");
    if (fee !== 0 && feeAsset !== currency && !baseFee) throw new Error("Non-quote fee accounting requires an asset/FX treatment");
    if (this.positionScopes.has(input.symbol) && this.positionScopes.get(input.symbol) !== input.scope) throw new Error("Position account scope mismatch");
    const previousPosition = this.positions.get(input.symbol);
    const previousCost = this.openCosts.get(input.symbol) ?? (previousPosition ? {
      quantity: String(previousPosition.quantity), cost: String(previousPosition.openCostBasis), entryFees: "0",
      realized: String(previousPosition.realizedPnl), entryOrderId: this.currentEntryMap.get(input.symbol)?.fillId ?? "", entryTime: this.currentEntryMap.get(input.symbol)?.entryTime ?? input.timestamp,
    } : undefined);
    // Gross execution progress/notional stays unchanged. A BUY base fee reduces
    // inventory received while its entire acquisition cost stays in the holding.
    if (baseFee && fee !== 0 && (side !== "buy" || decimal(fill.fee).compare(0) < 0 || decimal(fill.fee).compare(fill.quantity) >= 0)) {
      throw new Error("Base fees require a BUY with positive net received quantity");
    }
    const inventoryQty = baseFee ? decimal(fill.quantity).sub(fill.fee).toString() : fill.quantity;
    const netPositionDelta = decimal(inventoryQty).mul(side === "buy" ? 1 : -1).toNumber();
    const calculated = calculatePositionFill(previousCost, side, inventoryQty, fill.notional, quoteFee, input.orderId, input.timestamp);
    if (input.positionQty != null && decimal(input.positionQty).compare(calculated.position?.quantity ?? 0) !== 0) throw new Error("Broker position differs from the attributed quantity");
    const cash = decimal(this.exactCash.get(currency) ?? this.cashBook.get(currency) ?? 0).add(side === "buy" ? decimal(fill.notional).neg() : fill.notional).sub(quoteFee);
    if (cash.compare(0) < 0) throw new Error("Execution exceeds allocated cash");
    const cashNumber = cash.toNumber();
    const exactPosition = calculated.position;
    let nextPosition: PositionState | undefined;
    if (exactPosition) {
      const held = decimal(exactPosition.quantity).toNumber();
      const average = decimal(exactPosition.cost).div(exactPosition.quantity).toNumber();
      const mark = previousPosition && (this.positionMarkTimes.get(input.symbol) ?? -Infinity) > Date.parse(input.timestamp) ? previousPosition.currentPrice : price;
      const marketValue = decimal(mark).mul(exactPosition.quantity).toNumber();
      const unrealizedPnl = decimal(mark).mul(exactPosition.quantity).sub(exactPosition.cost).toNumber();
      const realizedPnl = decimal(exactPosition.realized).toNumber();
      nextPosition = { symbol: input.symbol, quantity: held, side: "long", avgFillPrice: average, currentPrice: mark, marketValue,
        openCostBasis: decimal(exactPosition.cost).toNumber(), realizedPnl, unrealizedPnl, totalPnl: decimal(realizedPnl).add(unrealizedPnl).toNumber() };
    }
    const realizedTotal = decimal(this.realizedTotalExact).add(calculated.realized);
    const feesTotal = decimal(this.feesTotalExact).add(quoteFee);
    const nativeFeeTotal = decimal(this.nativeFees.get(feeAsset) ?? 0).add(fill.fee).toString();
    const realizedNumber = realizedTotal.toNumber(), feesNumber = feesTotal.toNumber();
    const symbolRealizedExact = decimal(this.realizedBySymbol.get(input.symbol)?.exact ?? 0).add(calculated.realized);
    const symbolRealized = symbolRealizedExact.toNumber();
    const previousBalance = this.balances.get(currency);
    const nextBalance: BalanceState = { ...previousBalance, asset: currency, cash: cashNumber, equity: previousBalance?.equity ?? cashNumber,
      margin: previousBalance?.margin ?? 1, updatedAt: input.timestamp };
    nextBalance.buyingPower = this.computeBuyingPower(nextBalance);
    const equity = decimal(this.getTotalEquity(currency)).add(decimal(cashNumber).sub(this.cashBook.get(currency) ?? 0))
      .add(decimal(nextPosition?.marketValue ?? 0).sub(previousPosition?.marketValue ?? 0)).toNumber();
    nextBalance.equity = equity;
    const previousClosing = this.pendingClosingTrades.get(input.orderId);
    let closing: PendingClosingTrade | undefined;
    if (side === "sell" && previousCost) {
      const combinedQuantity = decimal(previousClosing?.accumulatedQuantity ?? 0).add(fill.quantity);
      const combinedNotional = decimal(previousClosing?.weightedExitPrice ?? 0).mul(previousClosing?.accumulatedQuantity ?? 0).add(fill.notional);
      const combinedGross = decimal(previousClosing?.accumulatedGrossPnl ?? 0).add(calculated.gross);
      closing = { key: input.orderId, tradeId: previousClosing?.tradeId ?? randomUUID(), symbol: input.symbol, side: "buy",
        entryOrderId: previousClosing?.entryOrderId ?? previousCost.entryOrderId, exitOrderId: input.orderId,
        entryPrice: combinedNotional.sub(combinedGross).div(combinedQuantity).toNumber(),
        weightedExitPrice: combinedNotional.div(combinedQuantity).toNumber(), accumulatedQuantity: combinedQuantity.toNumber(),
        accumulatedGrossPnl: combinedGross.toNumber(),
        accumulatedCommission: decimal(previousClosing?.accumulatedCommission ?? 0).add(calculated.allocatedFee).add(fill.fee).toNumber(),
        entryTime: previousClosing?.entryTime ?? previousCost.entryTime, latestExitTime: input.timestamp, status: nextOrder.status };
    }
    const trade = closing && TERMINAL_ORDER_STATUSES.has(nextOrder.status) ? this.closedTrade(closing) : undefined;
    // Publish only after every financial and compatibility calculation succeeds.
    this.accountScope = input.scope;
    if (fee !== 0) {
      this.nativeFees.set(feeAsset, nativeFeeTotal);
      this.orderFeeAssets.set(input.orderId, feeAsset);
    }
    this.orders.set(input.orderId, nextOrder);
    if (progress) this.fillProgress.set(progressKey, progress);
    if (input.clientOrderId) this.clientOrderIdIndex.set(input.clientOrderId, input.orderId);
    this.orderScopes.set(input.orderId, input.scope);
    this.positionScopes.set(input.symbol, input.scope);
    this.cashBook.set(currency, cashNumber);
    this.exactCash.set(currency, cash.toString());
    this.balances.set(currency, nextBalance);
    if (nextPosition && exactPosition) {
      this.positions.set(input.symbol, nextPosition); this.openCosts.set(input.symbol, exactPosition);
      this.positionMarkTimes.set(input.symbol, Math.max(this.positionMarkTimes.get(input.symbol) ?? -Infinity, Date.parse(input.timestamp)));
    } else {
      this.positions.delete(input.symbol); this.openCosts.delete(input.symbol); this.currentEntryMap.delete(input.symbol); this.positionMarkTimes.delete(input.symbol);
    }
    if (closing) {
      if (trade) { this.trades.push(trade); this.pendingClosingTrades.delete(input.orderId); }
      else this.pendingClosingTrades.set(input.orderId, closing);
    }
    if (identity && fingerprint) this.acceptedFills.set(identity, fingerprint);
    this.realizedTotalExact = realizedTotal.toString(); this.realizedTotal = realizedNumber;
    this.feesTotalExact = feesTotal.toString(); this.feesTotal = feesNumber;
    this.realizedBySymbol.set(input.symbol, { exact: symbolRealizedExact.toString(), value: symbolRealized }); this.fillTotalsActive = true;
    this.peakEquity = Math.max(this.peakEquity, equity);
    return { quantity, price, fee, notional, trade, netPositionDelta, baseFeeQty: baseFee ? fee : 0, feeAsset };
  }


  getFeesByAsset(): Record<string, string> { return Object.fromEntries(this.nativeFees); }

  private closedTrade(pending: PendingClosingTrade): Trade {
    return { id: pending.tradeId, symbol: pending.symbol, side: pending.side, entryOrderId: pending.entryOrderId,
      exitOrderId: pending.exitOrderId, entryPrice: pending.entryPrice, exitPrice: pending.weightedExitPrice,
      quantity: pending.accumulatedQuantity, grossPnl: pending.accumulatedGrossPnl, commission: pending.accumulatedCommission,
      netPnl: decimal(pending.accumulatedGrossPnl).sub(pending.accumulatedCommission).toNumber(), slippage: 0,
      entryTime: pending.entryTime, exitTime: pending.latestExitTime, holdingPeriodBars: 0 };
  }

  private constructor(userId: string, executionId: string) {
    this.userId = userId;
    this.executionId = executionId;
  }

  /**
   * Get or create a PortfolioManager instance for the given user/run.
   */
  static getInstance(userId: string, executionId: string): PortfolioManager {
    const key = `${userId}:${executionId}`;
    let instance = PortfolioManager.instances.get(key);
    if (!instance) {
      instance = new PortfolioManager(userId, executionId);
      PortfolioManager.instances.set(key, instance);
    }
    return instance;
  }

  /**
   * Remove a cached instance (e.g., on run cleanup).
   */
  static existingInstance(userId: string, executionId: string): PortfolioManager | undefined {
    return this.instances.get(`${userId}:${executionId}`);
  }

  /** Retain settled state for late owned fills for the existing order-owner TTL. */
  static retireInstance(userId: string, executionId: string): void {
    const key = `${userId}:${executionId}`;
    if (!this.instances.has(key)) return;
    const previous = this.retirementTimers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => this.removeInstance(userId, executionId), 86_400_000);
    timer.unref();
    this.retirementTimers.set(key, timer);
  }

  static removeInstance(userId: string, executionId: string): void {
    const key = `${userId}:${executionId}`;
    const timer = this.retirementTimers.get(key);
    if (timer) clearTimeout(timer);
    this.retirementTimers.delete(key);
    this.instances.delete(key);
  }

  /**
   * Destroy this instance: clear all in-memory state and remove from cache.
   * Should be called when a workflow run ends.
   */
  destroy(): void {
    this.nativeFees.clear(); this.orderFeeAssets.clear();
    this.fillProgress.clear(); this.acceptedFills.clear(); this.openCosts.clear(); this.exactCash.clear();
    this.positionScopes.clear(); this.orderScopes.clear(); this.realizedBySymbol.clear(); this.positionMarkTimes.clear();
    this.realizedTotalExact = "0"; this.feesTotalExact = "0"; this.realizedTotal = 0; this.feesTotal = 0; this.fillTotalsActive = false; this.accountScope = undefined;
    // Portfolio state
    this.orders.clear();
    this.algoOrders.clear();
    this.executions.clear();
    this.balances.clear();
    this.positions.clear();
    this.executionKeysSeen.clear();
    this.clientOrderIdIndex.clear();

    // Legacy state
    this.cashBook.clear();
    this.holdings.clear();
    this.fillLedger.length = 0;
    this.orderCumQtyMap.clear();
    this.trades.length = 0;
    this.pendingClosingTrades.clear();
    this.currentEntryMap.clear();
    this.peakEquity = 0;
    this.startingEquity = null;
    this.bootstrapped = false;

    PortfolioManager.removeInstance(this.userId, this.executionId);
    console.log(
      `[PortfolioManager] Destroyed instance for user=${this.userId} execution=${this.executionId}`,
    );
  }

  /**
   * Destroy all cached instances (e.g., on process shutdown).
   */
  static destroyAll(): void {
    for (const instance of PortfolioManager.instances.values()) {
      instance.destroy();
    }
    PortfolioManager.instances.clear();
    console.log("[PortfolioManager] All instances destroyed");
  }

  // ============== INSTRUMENT PARSING ==============

  /**
   * Parse a symbol into base and quote assets.
   * Supports: "ETH/USD", "BTC/USDT", "BTCUSDT", "AAPL"
   */
  parseInstrument(
    symbol: string,
    baseCurrency?: string,
  ): { baseAsset?: string; quoteAsset?: string } {
    // Slash-separated (e.g. ETH/USD, BTC/USDT)
    if (symbol.includes("/")) {
      const [base, quote] = symbol.split("/");
      return { baseAsset: base, quoteAsset: quote };
    }

    // Known quote suffix (e.g. BTCUSDT, ETHBUSD)
    for (const suffix of PortfolioManager.SYMBOL_QUOTE_SUFFIXES) {
      if (symbol.endsWith(suffix) && symbol.length > suffix.length) {
        return {
          baseAsset: symbol.slice(0, -suffix.length),
          quoteAsset: suffix,
        };
      }
    }

    // Check USD suffix last (after USDT/USDC)
    if (symbol.endsWith("USD") && symbol.length > 3) {
      return { baseAsset: symbol.slice(0, -3), quoteAsset: "USD" };
    }

    // Single equity symbol (e.g. AAPL) — fallback to baseCurrency
    return { baseAsset: symbol, quoteAsset: baseCurrency };
  }

  // ============== portfolio PUBLIC METHODS ==============

  /**
   * Register an order intent. Creates or upserts order state.
   * No cash/position mutation.
   */
  registerOrderIntent(input: {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    algoId?: string;
    side: "buy" | "sell";
    origQty: number | undefined;
    orderType: string;
    timeInForce: string;
    limitPrice?: number;
    stopPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    status: string;
  }): { order: OrderState } {
    const now = new Date().toISOString();
    const origQty = input.origQty ?? undefined;
    const order: OrderState = {
      orderId: input.orderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      timeInForce: input.timeInForce,
      status: input.status ?? "new",
      origQty,
      filledQty: 0,
      remainingQty: origQty,
      avgFillPrice: undefined,
      totalFees: 0,
      stopPrice: input.stopPrice,
      limitPrice: input.limitPrice,
      trailPercent: input.trailPercent,
      trailPrice: input.trailPrice,
      createdAt: now,
      updatedAt: now,
    };

    const normalizedBrokerId =
      input.orderId != null && input.orderId !== ""
        ? String(input.orderId)
        : undefined;

    if (!normalizedBrokerId) {
      throw new Error("Missing orderId for sync_order_event");
    }

    const previous = this.orders.get(normalizedBrokerId);
    if (previous) {
      if (previous.symbol !== input.symbol || previous.side !== input.side) throw new Error("Order intent identity mismatch");
      return { order: previous };
    }
    this.orders.set(normalizedBrokerId, order);
    if (input.clientOrderId) {
      this.clientOrderIdIndex.set(input.clientOrderId, normalizedBrokerId);
    }
    console.log(
      `[PortfolioManager] Registered order intent: ${input.side} ${input.origQty} ${input.symbol} (${normalizedBrokerId})`,
    );
    return { order };
  }

  /**
   * Apply an order lifecycle update. Updates order status, cumulative fill qty, etc.
   * No cash/position mutation.
   */
  applyOrderUpdate(input: {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side?: "buy" | "sell";
    origQty?: number;
    orderType?: string;
    timeInForce?: string;
    limitPrice?: number;
    stopPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    status: string;
    filledQty?: number;
    avgFillPrice?: number;
    feeAmount?: number;
    feeAsset?: string;
    _seq?: number;
  }): void {
    const now = new Date().toISOString();

    const normalizedBrokerId = String(input.orderId);
    let order = this.orders.get(normalizedBrokerId);
    if (!order) {
      if (!input.side) {
        throw new Error(
          `[PortfolioManager] applyOrderUpdate: side is required to create missing order for orderId=${input.orderId}`,
        );
      }

      const { order: createdOrder } = this.registerOrderIntent({
        orderId: normalizedBrokerId,
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: input.side,
        origQty: input.origQty,
        orderType: input.orderType ?? "market",
        timeInForce: input.timeInForce ?? "GTC",
        limitPrice: input.limitPrice,
        stopPrice: input.stopPrice,
        trailPercent: input.trailPercent,
        trailPrice: input.trailPrice,
        status: input.status,
      });
      order = createdOrder;
      return;
    }

    // Safety check: avoid silently mutating the wrong order
    if (order.symbol !== input.symbol) {
      throw new Error(
        `[PortfolioManager] applyOrderUpdate: symbol mismatch for orderId=${input.orderId}. existing=${order.symbol}, incoming=${input.symbol}`,
      );
    }

    // Guard 1: Sequence freshness — reject replayed/stale events
    const incomingSeq = input._seq ?? 0;
    if (
      order.lastSeq !== undefined &&
      incomingSeq > 0 &&
      incomingSeq <= order.lastSeq
    ) {
      console.warn(
        `[PortfolioManager] Stale seq ignored: ${input.orderId} lastSeq=${order.lastSeq} incomingSeq=${incomingSeq}`,
      );
      return;
    }

    // Guard 2: Status rank regression — reject lower-rank status
    const incomingRank = ORDER_STATUS_RANK[input.status] ?? 0;
    const currentRank = ORDER_STATUS_RANK[order.status] ?? 0;

    if (
      incomingRank < currentRank ||
      (incomingRank === currentRank && input.status !== order.status)
    ) {
      console.warn(
        `[PortfolioManager] Stale order update ignored: ${input.orderId} current=${order.status}(${currentRank}) incoming=${input.status}(${incomingRank})`,
      );
      return;
    }

    if (incomingSeq > 0) {
      order.lastSeq = incomingSeq;
    }

    // Apply broker lifecycle status first (only after freshness guards pass)
    order.status = input.status;
    const incomingFilledQty = input.filledQty ?? 0; // this event fill qty
    const incomingFillPrice = input.avgFillPrice ?? 0; // this event fill price

    const previousFilledQty = order.filledQty ?? 0;
    const previousAvgFillPrice = order.avgFillPrice ?? 0;

    const newFilledQty = previousFilledQty + incomingFilledQty;

    if (incomingFilledQty > 0 && newFilledQty > 0) {
      order.avgFillPrice =
        (previousAvgFillPrice * previousFilledQty +
          incomingFillPrice * incomingFilledQty) /
        newFilledQty;
    }

    order.filledQty = newFilledQty;

    if (order.origQty === undefined || order.origQty === null) {
      throw new Error(
        `Cannot calculate remainingQty: origQty is missing for order ${order.orderId}`,
      );
    }

    order.remainingQty = Math.max(0, order.origQty - order.filledQty);

    // Auto-normalize to filled when cumulative fill reaches origQty,
    // unless the status is already terminal
    if (
      order.origQty > 0 &&
      order.filledQty >= order.origQty &&
      !TERMINAL_ORDER_STATUSES.has(order.status)
    ) {
      order.status = "filled";
    }

    const fillIncreased = order.filledQty > previousFilledQty;
    if (fillIncreased && (input.feeAmount || 0) > 0) {
      order.totalFees += input.feeAmount || 0;
    }

    order.updatedAt = now;

    console.log(
      `[PortfolioManager] Order update: ${input.orderId} -> status=${order.status}, cumFilled=${order.filledQty}, remaining=${order.remainingQty}`,
    );
  }

  registerAlgoOrder(input: {
    algoId: string;
    orderId?: string;
    symbol: string;
    side: "buy" | "sell";
    orderType: string;
    origQty: number | undefined;
    status: string;
    stopPrice?: number;
    limitPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    rejectReason?: string;
    timeInForce: string;
  }): { algoOrder: AlgoOrderState } {
    const now = new Date().toISOString();
    const algoOrder: AlgoOrderState = {
      algoId: input.algoId,
      orderId: input.orderId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      status: input.status,
      stopPrice: input.stopPrice,
      limitPrice: input.limitPrice,
      trailPercent: input.trailPercent,
      trailPrice: input.trailPrice,
      origQty: input.origQty,
      rejectReason: input.rejectReason,
      timeInForce: input.timeInForce,
      createdAt: now,
      updatedAt: now,
    };
    this.algoOrders.set(input.algoId, algoOrder);
    return { algoOrder };
  }

  applyAlgoUpdate(input: {
    algoId: string;
    orderId?: string;
    symbol: string;
    side: "buy" | "sell";
    orderType: string;
    origQty: number | undefined;
    status: string;
    stopPrice?: number;
    limitPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    rejectReason?: string;
    timeInForce: string;
    _seq?: number;
  }): void {
    const now = new Date().toISOString();
    let algoOrder = this.algoOrders.get(input.algoId);

    if (!algoOrder) {
      const { algoOrder: createdAlgoOrder } = this.registerAlgoOrder(input);
      algoOrder = createdAlgoOrder;
    }

    if (algoOrder.symbol !== input.symbol) {
      throw new Error(
        `[PortfolioManager] applyAlgoUpdate: symbol mismatch for algoId=${input.algoId}. existing=${algoOrder.symbol}, incoming=${input.symbol}`,
      );
    }

    const incomingSeq = input._seq ?? 0;
    if (
      algoOrder.lastSeq !== undefined &&
      incomingSeq > 0 &&
      incomingSeq <= algoOrder.lastSeq
    ) {
      console.warn(
        `[PortfolioManager] Stale algo seq ignored: ${input.algoId} lastSeq=${algoOrder.lastSeq} incomingSeq=${incomingSeq}`,
      );
      return;
    }

    const incomingRank = ALGO_STATUS_RANK[input.status] ?? 0;
    const currentRank = ALGO_STATUS_RANK[algoOrder.status] ?? 0;
    if (
      incomingRank < currentRank ||
      (incomingRank === currentRank && input.status !== algoOrder.status)
    ) {
      console.warn(
        `[PortfolioManager] Stale algo update ignored: ${input.algoId} current=${algoOrder.status}(${currentRank}) incoming=${input.status}(${incomingRank})`,
      );
      return;
    }

    if (incomingSeq > 0) {
      algoOrder.lastSeq = incomingSeq;
    }

    algoOrder.orderId = input.orderId ?? algoOrder.orderId;
    algoOrder.status = input.status;
    algoOrder.stopPrice = input.stopPrice;
    algoOrder.limitPrice = input.limitPrice;
    algoOrder.trailPercent = input.trailPercent;
    algoOrder.trailPrice = input.trailPrice;
    algoOrder.origQty = input.origQty;
    algoOrder.rejectReason = input.rejectReason;
    algoOrder.timeInForce = input.timeInForce;
    algoOrder.updatedAt = now;
  }

  applyTrade(
    input: {
      orderId: string;
      clientOrderId?: string;
      executionId?: string;
      symbol: string;
      side: "buy" | "sell";
      filledQty: number;
      fillPrice: number;
      feeAmount: number;
      status: string;
      baseCurrency: string;
    },
    now: string,
  ): ApplyTradeResult {
    if (input.executionId) {
      if (this.executionKeysSeen.has(input.executionId)) {
        return { kind: "skipped", reason: "duplicate_execution" };
      }
      this.executionKeysSeen.add(input.executionId);
      if (this.executionKeysSeen.size > PortfolioManager.MAX_EXECUTION_KEYS) {
        const oldest = this.executionKeysSeen.values().next().value;
        if (oldest) this.executionKeysSeen.delete(oldest);
      }
    }

    if (!input.orderId) {
      return { kind: "skipped", reason: "missing_order_id" };
    }

    const key = input.orderId;
    const existingPending = this.pendingClosingTrades.get(key);

    if (
      TERMINAL_ORDER_STATUSES.has(input.status) &&
      (!input.filledQty || input.filledQty <= 0) &&
      existingPending
    ) {
      const trade: Trade = {
        id: existingPending.tradeId,
        symbol: existingPending.symbol,
        side: existingPending.side,
        entryOrderId: existingPending.entryOrderId,
        exitOrderId: existingPending.exitOrderId,
        entryPrice: existingPending.entryPrice,
        exitPrice: existingPending.weightedExitPrice,
        quantity: existingPending.accumulatedQuantity,
        grossPnl: existingPending.accumulatedGrossPnl,
        commission: existingPending.accumulatedCommission,
        slippage: 0,
        netPnl:
          existingPending.accumulatedGrossPnl -
          existingPending.accumulatedCommission,
        entryTime: existingPending.entryTime,
        exitTime: now,
        holdingPeriodBars: 0,
      };

      this.trades.push(trade);
      this.pendingClosingTrades.delete(key);
      return { kind: "finalized", trade };
    }

    const existing = this.positions.get(input.symbol);
    if (!existing) return { kind: "skipped", reason: "missing_position" };

    const signedQty = input.side === "buy" ? input.filledQty : -input.filledQty;
    const prevQty = existing.quantity;

    // Same direction means position increase, so no closed trade to record
    const sameDirection =
      (prevQty >= 0 && signedQty >= 0) || (prevQty <= 0 && signedQty <= 0);

    if (sameDirection)
      return { kind: "skipped", reason: "same_direction_fill" };

    const closingQty = Math.min(Math.abs(prevQty), Math.abs(signedQty));
    if (closingQty <= 0) return { kind: "skipped", reason: "no_closing_qty" };

    const isClosingLong = prevQty > 0;
    const tradeSide: "buy" | "sell" = isClosingLong ? "buy" : "sell";
    const eventGrossPnl = isClosingLong
      ? (input.fillPrice - existing.avgFillPrice) * closingQty
      : (existing.avgFillPrice - input.fillPrice) * closingQty;

    const entry = this.currentEntryMap.get(input.symbol);

    let pending: PendingClosingTrade;

    if (!existingPending) {
      pending = {
        key,
        tradeId: randomUUID(),
        symbol: input.symbol,
        side: tradeSide,
        entryOrderId: entry?.fillId ?? "",
        exitOrderId: input.orderId,
        entryPrice: existing.avgFillPrice,
        weightedExitPrice: input.fillPrice,
        accumulatedQuantity: closingQty,
        accumulatedGrossPnl: eventGrossPnl,
        accumulatedCommission: input.feeAmount ?? 0,
        entryTime: entry?.entryTime ?? "",
        latestExitTime: now,
        status: input.status,
      };
      this.pendingClosingTrades.set(key, pending);
    } else {
      const oldQty = existingPending.accumulatedQuantity;
      const newQty = oldQty + closingQty;
      const weightedExitPrice =
        newQty > 0
          ? (existingPending.weightedExitPrice * oldQty +
              input.fillPrice * closingQty) /
            newQty
          : existingPending.weightedExitPrice;

      pending = {
        ...existingPending,
        weightedExitPrice,
        accumulatedQuantity: newQty,
        accumulatedGrossPnl:
          existingPending.accumulatedGrossPnl + eventGrossPnl,
        accumulatedCommission:
          existingPending.accumulatedCommission + (input.feeAmount ?? 0),
        latestExitTime: now,
        status: input.status,
      };
      this.pendingClosingTrades.set(key, pending);
    }

    if (!TERMINAL_ORDER_STATUSES.has(input.status)) {
      return { kind: "pendingUpdate", pending };
    }

    const trade: Trade = {
      id: pending.tradeId,
      symbol: pending.symbol,
      side: pending.side,
      entryOrderId: pending.entryOrderId,
      exitOrderId: input.orderId,
      entryPrice: pending.entryPrice,
      exitPrice: pending.weightedExitPrice,
      quantity: pending.accumulatedQuantity,
      grossPnl: pending.accumulatedGrossPnl,
      commission: pending.accumulatedCommission,
      slippage: 0,
      netPnl: pending.accumulatedGrossPnl - pending.accumulatedCommission,
      entryTime: pending.entryTime,
      exitTime: pending.latestExitTime,
      holdingPeriodBars: 0,
    };

    this.trades.push(trade);
    this.pendingClosingTrades.delete(key);
    return { kind: "finalized", trade };
  }

  /**
   * Reconcile position with absolute broker quantity.
   * Sets the position to the exact quantity the broker reports.
   * This is where Alpaca's 0.9982 gets recorded correctly.
   */
  applyPositionUpdate(input: {
    symbol: string;
    filledQty?: number;
    avgFillPrice?: number; // Alpaca: order.filled_avg_price or raw price
    side: "buy" | "sell";
    normalizedBrokerId?: string;
    executionId?: string;
    positionQty?: number; // broker-truth resulting position qty
    currentPrice?: number;
    openCostBasis?: number;
    marketValue?: number;
    realizedPnl?: number;
    unrealizedPnl?: number;
  }): { position: PositionState | null } {
    const now = new Date().toISOString();
    const tracked = this.openCosts.get(input.symbol);
    if (tracked) {
      const target = input.positionQty != null ? decimal(input.positionQty) : decimal(tracked.quantity).add(input.side === "buy" ? input.filledQty ?? 0 : -(input.filledQty ?? 0));
      if (target.compare(tracked.quantity) !== 0) throw new Error("Apply position changes through sync_order_event so cash, basis and fees stay consistent");
      // A matching broker snapshot may refresh the mark, never the accepted
      // basis or remaining entry fees through a rounded average price.
      const position = this.positions.get(input.symbol);
      if (position && input.currentPrice != null) {
        const mark = decimal(input.currentPrice);
        if (mark.compare(0) <= 0) throw new Error("Positive market price is required");
        const currentPrice = mark.toNumber();
        const marketValue = mark.mul(tracked.quantity).toNumber();
        const unrealizedPnl = mark.mul(tracked.quantity).sub(tracked.cost).toNumber();
        const totalPnl = decimal(position.realizedPnl).add(unrealizedPnl).toNumber();
        Object.assign(position, { currentPrice, marketValue, unrealizedPnl, totalPnl });
        this.positionMarkTimes.set(input.symbol, Date.now());
      }
      return { position: position ?? null };
    }
    const existing = this.positions.get(input.symbol);

    const calculatePositionMetrics = (
      quantity: number,
      avgFillPrice: number,
      currentPrice: number,
      realizedPnl: number,
    ) => {
      const absQty = Math.abs(quantity);

      const openCostBasis = absQty * avgFillPrice;
      const marketValue = absQty * currentPrice;

      const unrealizedPnl = (currentPrice - avgFillPrice) * quantity;

      const totalPnl = realizedPnl + unrealizedPnl;

      return {
        side: quantity >= 0 ? ("long" as const) : ("short" as const),
        openCostBasis,
        marketValue,
        unrealizedPnl,
        totalPnl,
      };
    };

    const getSignedFillQty = (
      filledQty: number,
      side: "buy" | "sell",
    ): number => {
      const abs = Math.abs(filledQty);
      return side === "buy" ? abs : -abs;
    };

    const deriveNextQty = (
      previousQty: number,
      input: {
        filledQty?: number;
        side: "buy" | "sell";
        positionQty?: number;
      },
    ): number => {
      if (input.positionQty != null) {
        return input.positionQty;
      }

      if (input.filledQty == null) {
        return previousQty;
      }

      return previousQty + getSignedFillQty(input.filledQty, input.side);
    };

    const isSameDirectionIncrease = (
      previousQty: number,
      nextQty: number,
    ): boolean => {
      if (previousQty > 0 && nextQty > previousQty) return true; // long increased
      if (previousQty < 0 && nextQty < previousQty) return true; // short increased
      if (previousQty === 0 && nextQty !== 0) return true; // new position opened
      return false;
    };

    const isReductionWithoutFlip = (
      previousQty: number,
      nextQty: number,
    ): boolean => {
      if (previousQty > 0 && nextQty >= 0 && nextQty < previousQty) return true;
      if (previousQty < 0 && nextQty <= 0 && nextQty > previousQty) return true;
      return false;
    };

    const isFlip = (previousQty: number, nextQty: number): boolean => {
      return (
        (previousQty > 0 && nextQty < 0) || (previousQty < 0 && nextQty > 0)
      );
    };

    const getEffectiveIncreaseQty = (
      previousQty: number,
      nextQty: number,
    ): number => {
      return Math.max(0, Math.abs(nextQty) - Math.abs(previousQty));
    };

    if (existing) {
      const previousQty = existing.quantity;
      const previousavgFillPrice = existing.avgFillPrice ?? 0;
      const previousCurrentPrice =
        existing.currentPrice ?? previousavgFillPrice ?? 0;

      const nextQty = deriveNextQty(previousQty, input);

      if (nextQty === 0) {
        this.positions.delete(input.symbol);
        this.currentEntryMap.delete(input.symbol);
        return { position: null };
      }

      let nextavgFillPrice = previousavgFillPrice;

      // Explicit broker avg wins if provided
      if (input.avgFillPrice != null) {
        if (isSameDirectionIncrease(previousQty, nextQty)) {
          const previousAbsQty = Math.abs(previousQty);
          const nextAbsQty = Math.abs(nextQty);

          if (previousAbsQty === 0) {
            nextavgFillPrice = input.avgFillPrice;
          } else {
            const effectiveIncreaseQty = getEffectiveIncreaseQty(
              previousQty,
              nextQty,
            );

            if (effectiveIncreaseQty > 0 && nextAbsQty > 0) {
              nextavgFillPrice =
                (previousAbsQty * previousavgFillPrice +
                  effectiveIncreaseQty * input.avgFillPrice) /
                nextAbsQty;
            }
          }
        } else if (isReductionWithoutFlip(previousQty, nextQty)) {
          // Keep old avg on partial reduction / close without reversal
          nextavgFillPrice = previousavgFillPrice;
        } else if (isFlip(previousQty, nextQty)) {
          // Opposite-side leftover becomes a fresh position at fill price
          nextavgFillPrice = input.avgFillPrice;
        }
      }

      const nextCurrentPrice =
        input.currentPrice ??
        existing.currentPrice ??
        input.avgFillPrice ??
        nextavgFillPrice ??
        previousCurrentPrice ??
        0;

      existing.quantity = nextQty;
      existing.side = nextQty >= 0 ? "long" : "short";
      existing.avgFillPrice = nextavgFillPrice;
      existing.currentPrice = nextCurrentPrice;

      const metrics = calculatePositionMetrics(
        existing.quantity,
        existing.avgFillPrice,
        existing.currentPrice,
        existing.realizedPnl ?? 0,
      );

      existing.openCostBasis = metrics.openCostBasis;
      existing.marketValue = metrics.marketValue;
      existing.unrealizedPnl = metrics.unrealizedPnl;
      existing.totalPnl = metrics.totalPnl;

      // Refresh entry map when a brand-new position is opened or a flip happens
      if (previousQty === 0 || isFlip(previousQty, nextQty)) {
        this.currentEntryMap.set(input.symbol, {
          fillId:
            input.executionId ??
            input.normalizedBrokerId ??
            `entry-${Date.now()}`,
          entryTime: now,
        });
      } else if (!this.currentEntryMap.has(input.symbol)) {
        this.currentEntryMap.set(input.symbol, {
          fillId:
            input.executionId ??
            input.normalizedBrokerId ??
            `entry-${Date.now()}`,
          entryTime: now,
        });
      }

      return { position: existing };
    }

    const quantity = deriveNextQty(0, input);

    if (quantity === 0) {
      return { position: null };
    }

    const avgFillPrice = input.avgFillPrice ?? 0;

    const currentPrice = input.currentPrice ?? avgFillPrice;

    const metrics = calculatePositionMetrics(
      quantity,
      avgFillPrice,
      currentPrice,
      0,
    );

    const position: PositionState = {
      symbol: input.symbol,
      quantity,
      side: metrics.side,
      avgFillPrice,
      currentPrice,
      openCostBasis: metrics.openCostBasis,
      marketValue: metrics.marketValue,
      realizedPnl: 0,
      unrealizedPnl: metrics.unrealizedPnl,
      totalPnl: metrics.totalPnl,
    };

    this.positions.set(input.symbol, position);
    this.currentEntryMap.set(input.symbol, {
      fillId:
        input.executionId ?? input.normalizedBrokerId ?? `entry-${Date.now()}`,
      entryTime: now,
    });

    return { position };
  }
  /**
   * Reconcile a balance with broker truth (one asset per call).
   * Becomes the source of truth for getCash().
   */
  reconcileBalance(input: {
    asset: string;
    cash: number;
    buyingPower?: number;
    initialMargin?: number;
    margin: number;
    equity: number;
    locked?: number;
  }): { reconciled: boolean; balance: BalanceState } {
    const now = new Date().toISOString();

    this.exactCash.delete(input.asset);
    const multiplier = input.margin ?? 1;

    // For your current Alpaca behavior:
    // - if broker gives buyingPower, trust it
    // - otherwise fallback to cash-based BP
    const computedBuyingPower =
      input.buyingPower ?? Math.max(input.cash, 0) * multiplier;

    const balance: BalanceState = {
      asset: input.asset,
      cash: input.cash,
      buyingPower: computedBuyingPower,
      margin: multiplier,
      initialMargin: input.initialMargin ?? 0,
      equity: input.equity,
      locked: input.locked ?? 0,
      updatedAt: now,
    };

    this.balances.set(input.asset, balance);

    // Sync to legacy cashBook
    this.cashBook.set(input.asset, input.cash);

    // Update peak equity if this is trusted account state
    if (input.equity > this.peakEquity) {
      this.peakEquity = input.equity;
    }

    console.log(
      `[PortfolioManager] Balance reconciled: ${input.asset} cash=${input.cash} equity=${input.equity} buyingPower=${computedBuyingPower} margin=${multiplier} initialMargin=${input.initialMargin ?? 0}`,
    );

    return { reconciled: true, balance };
  }

  private findOrderByClientId(clientOrderId: string): OrderState | undefined {
    const orderId = this.clientOrderIdIndex.get(clientOrderId);
    if (orderId) return this.orders.get(orderId);
    return undefined;
  }

  resolveOrderIdByClientId(clientOrderId: string): string | undefined {
    if (!clientOrderId) return undefined;
    return this.clientOrderIdIndex.get(clientOrderId);
  }

  /**
   * Get the current cumulative filled quantity for an order.
   * Returns 0 if the order is not found.
   */
  getOrderfilledQty(orderId: string): number {
    const order = this.orders.get(orderId);
    return order?.filledQty ?? 0;
  }

  private computeBuyingPower(balance: BalanceState): number {
    const multiplier = balance.margin ?? 1;
    return Math.max(balance.cash, 0) * multiplier;
  }

  private updateBalance(
    quoteAsset: string,
    side: "buy" | "sell",
    notional: number,
    now: string,
  ): void {
    const balance = this.balances.get(quoteAsset);
    const currentCash = balance?.cash ?? this.cashBook.get(quoteAsset) ?? 0;

    const updatedCash =
      side === "buy" ? currentCash - notional : currentCash + notional;

    const nextBalance: BalanceState = balance ?? {
      asset: quoteAsset,
      cash: 0,
      margin: 1,
      buyingPower: 0,
      equity: 0,
      initialMargin: 0,
      locked: 0,
      updatedAt: now,
    };

    nextBalance.cash = updatedCash;
    nextBalance.updatedAt = now;

    // keep legacy cashBook in sync first
    this.cashBook.set(quoteAsset, updatedCash);

    // equity is still total account value
    nextBalance.equity = this.getTotalEquity(quoteAsset);

    // Alpaca current behavior in your case: BP from cash, not total equity
    nextBalance.buyingPower = this.computeBuyingPower(nextBalance);

    this.balances.set(quoteAsset, nextBalance);

    if (nextBalance.equity > this.peakEquity) {
      this.peakEquity = nextBalance.equity;
    }
  }

  private updateFeeBalance(
    feeAsset: string,
    feeAmount: number,
    now: string,
  ): void {
    const balance = this.balances.get(feeAsset);
    const currentCash = balance?.cash ?? this.cashBook.get(feeAsset) ?? 0;

    const updatedCash = currentCash - feeAmount;

    const nextBalance: BalanceState = balance ?? {
      asset: feeAsset,
      cash: 0,
      margin: 1,
      buyingPower: 0,
      equity: 0,
      initialMargin: 0,
      locked: 0,
      updatedAt: now,
    };

    nextBalance.cash = updatedCash;
    nextBalance.updatedAt = now;

    // sync legacy cashBook first
    this.cashBook.set(feeAsset, updatedCash);

    // recompute equity
    nextBalance.equity = this.getTotalEquity(feeAsset);

    // Alpaca current behavior in your case: BP from cash, not total equity
    nextBalance.buyingPower = this.computeBuyingPower(nextBalance);

    this.balances.set(feeAsset, nextBalance);

    if (nextBalance.equity > this.peakEquity) {
      this.peakEquity = nextBalance.equity;
    }
  }
  /**
   * Apply fill-level accounting updates for quote cash, fees, and peak equity.
   * Intended for broker_sync_order_event execution paths.
   */
  applyFillAccounting(input: {
    symbol: string;
    side: "buy" | "sell";
    fillPrice: number;
    fillQty: number;
    feeAmount?: number;
    feeAsset?: string;
    baseCurrency?: string;
  }): void {
    const now = new Date().toISOString();
    const { quoteAsset } = this.parseInstrument(
      input.symbol,
      input.baseCurrency,
    );
    const effectiveQuoteAsset = quoteAsset ?? input.baseCurrency ?? "USD";

    const notional = input.fillPrice * input.fillQty;

    this.updateBalance(effectiveQuoteAsset, input.side, notional, now);

    if (input.feeAmount && input.feeAmount > 0) {
      const feeBalanceAsset = input.feeAsset ?? effectiveQuoteAsset;
      this.updateFeeBalance(feeBalanceAsset, input.feeAmount, now);
    }

    this.updateEquity(input.baseCurrency);
  }

  // ============== portfolio READ METHODS ==============

  /**
   * Get all pending orders (portfolio model — derives from orders map).
   */
  getOpenOrders(): OrderState[] {
    return Array.from(this.orders.values()).filter((o) =>
      OPEN_ORDER_STATUSES.has(o.status),
    );
  }

  getAlgoOrder(algoId: string): AlgoOrderState | undefined {
    return this.algoOrders.get(algoId);
  }

  getOpenAlgoOrders(): AlgoOrderState[] {
    return Array.from(this.algoOrders.values()).filter((o) =>
      OPEN_ALGO_ORDER_STATUSES.has(o.status),
    );
  }

  /**
   * Get all portfolio positions.
   */
  getPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get all portfolio balances.
   */
  getV2Balances(): Record<string, BalanceState> {
    return Object.fromEntries(this.balances);
  }

  /**
   * Get a single portfolio order by broker order ID.
   */
  getOrder(orderId: string): OrderState | undefined {
    return this.orders.get(orderId);
  }

  // ============== PEAK EQUITY ==============

  private updateEquity(baseCurrency: string = "USDT"): void {
    const currentEquity = this.getTotalEquity(baseCurrency);
    if (this.startingEquity === null && currentEquity > 0) {
      this.startingEquity = currentEquity;
    }
    this.peakEquity = Math.max(this.peakEquity, currentEquity);
  }
  // ============== GETTERS (mirror SimBroker interface) ==============

  /**
   * Get full portfolio state in the same shape as SimBroker.
   */
  getPortfolioState(baseCurrency: string = "USDT"): {
    cash: Record<string, number>;
    positions: Position[];
    trades: Trade[];
    totalEquity: number;
    peakEquity: number;
    startingEquity: number | null;
    pendingOrders: OrderState[];
    algoOrders: AlgoOrderState[];
    cumulativeRealizedPnl: number;
    realizedPnlBySymbol: Record<string, number>;
    cumulativeFees: number;
  } {
    const positionStates = this.getPositions();

    const positions: Position[] = positionStates.map((p) => {
      const absQty = Math.abs(p.quantity);
      const marketValue = absQty * p.currentPrice;
      const openCostBasis = p.openCostBasis;
      const unrealizedPnl = p.quantity >= 0 ? marketValue - openCostBasis : (p.currentPrice - p.avgFillPrice) * p.quantity;

      return {
        symbol: p.symbol,
        side: p.quantity >= 0 ? "long" : "short",
        quantity: p.quantity,
        avgFillPrice: p.avgFillPrice,
        currentPrice: p.currentPrice,
        unrealizedPnl,
        realizedPnl: p.realizedPnl,
        marketValue,
        openCostBasis,
        totalPnl: p.realizedPnl + unrealizedPnl,
      };
    });

    const cashBase = this.cashBook.get(baseCurrency) ?? 0;

    const positionsEquityValue = positionStates.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );

    const totalEquity = cashBase + positionsEquityValue;
    const realizedPnlBySymbol: Record<string, number> = {};
    let cumulativeRealizedPnl = 0;
    if (!this.fillTotalsActive) for (const trade of this.trades) {
      cumulativeRealizedPnl += trade.netPnl;
      realizedPnlBySymbol[trade.symbol] =
        (realizedPnlBySymbol[trade.symbol] ?? 0) + trade.netPnl;
    }
    let cumulativeFees = 0;
    if (!this.fillTotalsActive) for (const order of this.orders.values()) {
      cumulativeFees += order.totalFees;
    }
    if (this.fillTotalsActive) {
      cumulativeRealizedPnl = this.realizedTotal;
      cumulativeFees = this.feesTotal;
      for (const [symbol, pnl] of this.realizedBySymbol) realizedPnlBySymbol[symbol] = pnl.value;
    }


    return {
      cash: Object.fromEntries(this.cashBook),
      positions,
      trades: this.trades,
      totalEquity,
      peakEquity: this.peakEquity,
      startingEquity: this.startingEquity,
      pendingOrders: this.getOpenOrders(),
      algoOrders: this.getOpenAlgoOrders(),
      cumulativeRealizedPnl,
      realizedPnlBySymbol,
      cumulativeFees,
    };
  }

  getPosition(symbol: string): Position | null {
    const p = this.positions.get(symbol);
    if (!p) return null;

    const absQty = Math.abs(p.quantity);
    const marketValue = absQty * p.currentPrice;
    const openCostBasis = p.openCostBasis;
    const unrealizedPnl = p.quantity >= 0 ? marketValue - openCostBasis : (p.currentPrice - p.avgFillPrice) * p.quantity;

    return {
      symbol: p.symbol,
      side: p.quantity >= 0 ? "long" : "short",
      quantity: p.quantity,
      avgFillPrice: p.avgFillPrice,
      currentPrice: p.currentPrice,
      unrealizedPnl,
      realizedPnl: p.realizedPnl,
      marketValue,
      openCostBasis,
      totalPnl: p.realizedPnl + unrealizedPnl,
    };
  }

  getPositionQuery(symbols: readonly string[]): PositionQueryPayload {
    const positions =
      symbols.length === 0
        ? this.getPortfolioState().positions
        : symbols
            .map((symbol) => this.getPosition(symbol))
            .filter((position): position is Position => position !== null);

    return shapePositionQuery(positions);
  }

  getCash(): Record<string, number> {
    return Object.fromEntries(this.cashBook);
  }

  getTotalEquity(baseCurrency: string = "USDT"): number {
    const cashBase = this.cashBook.get(baseCurrency) ?? 0;
    const posValue = Array.from(this.positions.values()).reduce(
      (sum, position) => sum + position.quantity * position.currentPrice,
      0,
    );
    return cashBase + posValue;
  }

  getPeakEquity(): number {
    return this.peakEquity;
  }

  getStartingEquity(): number | null {
    return this.startingEquity;
  }

  getTrades(): Trade[] {
    return this.trades;
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  // ============== EXPLICIT PORTFOLIO INIT ==============

  /**
   * Initialize portfolio with explicit base currency and cash balance.
   * Used by create_portfolio operation (no broker API call).
   */
  initializePortfolio(baseCurrency: string, cashBalance: number): void {
    if (this.bootstrapped) return;

    if (this.fillTotalsActive) throw new Error("Cannot replace the allocation after accepting fills");
    if (!Number.isFinite(cashBalance) || cashBalance < 0) throw new Error("Explicit nonnegative cash allocation is required");
    decimal(cashBalance).toNumber();
    this.exactCash.set(baseCurrency, String(cashBalance));
    this.cashBook.set(baseCurrency, cashBalance);

    // Also set in portfolio balances
    this.balances.set(baseCurrency, {
      asset: baseCurrency,
      cash: cashBalance,
      equity: cashBalance,
      margin: 1,
      updatedAt: new Date().toISOString(),
    });

    if (this.startingEquity === null && cashBalance > 0) {
      this.startingEquity = cashBalance;
    }
    this.peakEquity = Math.max(this.peakEquity, cashBalance);

    this.bootstrapped = true;

    console.log(
      `[PortfolioManager] Initialized portfolio: ${baseCurrency} = ${cashBalance}`,
    );
  }

  /** Capture the explicit allocation after optional initial positions are seeded. */
  initializeEquity(baseCurrency: string): void {
    if (this.fillTotalsActive) throw new Error("Cannot reset initial equity after accepting fills");
    const equity = decimal(this.getTotalEquity(baseCurrency)).toNumber();
    this.startingEquity = equity;
    this.peakEquity = equity;
  }

  // ============== MARK-TO-MARKET (Valuation Loop) ==============

  /**
   * Update holding market prices for mark-to-market valuation.
   * Does not modify quantity, avg entry price, cash, or realized PnL.
   */
  updateMarketPrices(
    prices: Record<string, number>,
    baseCurrency: string = "USDT",
  ): void {
    const markTime = Date.now();

    for (const [symbol, price] of Object.entries(prices)) {
      const position = this.positions.get(symbol);
      if (!position) continue;

      const absQty = Math.abs(position.quantity);

      position.currentPrice = price;
      this.positionMarkTimes.set(symbol, markTime);
      position.marketValue = absQty * price;
      position.unrealizedPnl = position.quantity >= 0 ? position.marketValue - position.openCostBasis :
        (position.currentPrice - position.avgFillPrice) * position.quantity;
      position.totalPnl = position.realizedPnl + position.unrealizedPnl;
    }

    this.updateEquity(baseCurrency);
  }

  /**
   * Cancel/remove a pending order by orderId (broker or client).
   */
  cancelOrder(orderId: string): { removed: boolean; order?: OrderState } {
    // Try direct lookup by broker order ID
    let order = this.orders.get(orderId);

    // Fallback: try resolving via client order ID index
    if (!order) {
      const resolvedId = this.clientOrderIdIndex.get(orderId);
      if (resolvedId) {
        order = this.orders.get(resolvedId);
      }
    }

    if (!order) {
      console.log(
        `[PortfolioManager] Cancel: no pending order found for ${orderId}`,
      );
      return { removed: false };
    }

    if (order.status === "canceled" || order.status === "filled") {
      console.log(
        `[PortfolioManager] Cancel: order ${orderId} already ${order.status}`,
      );
      return { removed: false, order };
    }

    order.status = "canceled";
    order.updatedAt = new Date().toISOString();
    console.log(
      `[PortfolioManager] Cancelled order: ${orderId} (${order.side} ${order.origQty} ${order.symbol})`,
    );
    return { removed: true, order };
  }
}
