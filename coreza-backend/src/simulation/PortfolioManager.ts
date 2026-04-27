/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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

// ============== NEW INTERFACES (v2 state model) ==============

export interface OrderState {
  brokerOrderId?: string;
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
  totalFees: number;
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
  brokerOrderId?: string;
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
  new: 20,
  New: 20,
  replaced: 25,
  pending_replace: 25,
  partially_filled: 30,
  pending_cancel: 35,
  filled: 40,
  finished: 40,
  canceled: 50,
  cancelled: 50,
  expired: 50,
  rejected: 50,
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
 * v2 model: Separate order lifecycle, execution accounting, position reconciliation, and balance reconciliation.
 *
 * One instance per (userId, executionId) pair, managed via static cache.
 */
export class PortfolioManager {
  private static instances = new Map<string, PortfolioManager>();
  private static readonly SYMBOL_QUOTE_SUFFIXES = [
    "USDT",
    "USDC",
    "BUSD",
    "FDUSD",
  ];

  private userId: string;
  private executionId: string;

  // ============== v2 STATE MAPS ==============
  private orders = new Map<string, OrderState>();
  private algoOrders = new Map<string, AlgoOrderState>();
  private executions = new Map<string, ExecutionRecord>();
  private balances = new Map<string, BalanceState>();
  private positions = new Map<string, PositionState>();
  private executionKeysSeen = new Set<string>();
  private static readonly MAX_EXECUTION_KEYS = 50_000;
  private clientOrderIdIndex = new Map<string, string>(); // clientOrderId → brokerOrderId

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
  private tradeIdCounter = 0;
  private peakEquity = 0;
  private startingEquity: number | null = null;

  private bootstrapped = false;

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
  static removeInstance(userId: string, executionId: string): void {
    PortfolioManager.instances.delete(`${userId}:${executionId}`);
  }

  /**
   * Destroy this instance: clear all in-memory state and remove from cache.
   * Should be called when a workflow run ends.
   */
  destroy(): void {
    // v2 state
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
    this.tradeIdCounter = 0;
    this.peakEquity = 0;
    this.startingEquity = null;
    this.bootstrapped = false;

    PortfolioManager.instances.delete(`${this.userId}:${this.executionId}`);
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

  // ============== v2 PUBLIC METHODS ==============

  /**
   * Register an order intent. Creates or upserts order state.
   * No cash/position mutation.
   */
  registerOrderIntent(input: {
    brokerOrderId: string;
    clientOrderId?: string;
    symbol: string;
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
      brokerOrderId: input.brokerOrderId,
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
      input.brokerOrderId != null && input.brokerOrderId !== ""
        ? String(input.brokerOrderId)
        : undefined;

    if (!normalizedBrokerId) {
      throw new Error("Missing brokerOrderId for sync_order_event");
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
    brokerOrderId: string;
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

    const normalizedBrokerId = String(input.brokerOrderId);
    let order = this.orders.get(normalizedBrokerId);
    if (!order) {
      if (!input.side) {
        throw new Error(
          `[PortfolioManager] applyOrderUpdate: side is required to create missing order for brokerOrderId=${input.brokerOrderId}`,
        );
      }

      const { order: createdOrder } = this.registerOrderIntent({
        brokerOrderId: normalizedBrokerId,
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: input.side,
        origQty: input.origQty,
        filledQty: input.filledQty,
        remainingQty: input.origQty,
        avgFillPrice: input.avgFillPrice,
        orderType: input.orderType,
        timeInForce: input.timeInForce,
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
        `[PortfolioManager] applyOrderUpdate: symbol mismatch for brokerOrderId=${input.brokerOrderId}. existing=${order.symbol}, incoming=${input.symbol}`,
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
        `[PortfolioManager] Stale seq ignored: ${input.brokerOrderId} lastSeq=${order.lastSeq} incomingSeq=${incomingSeq}`,
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
        `[PortfolioManager] Stale order update ignored: ${input.brokerOrderId} current=${order.status}(${currentRank}) incoming=${input.status}(${incomingRank})`,
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
      `[PortfolioManager] Order update: ${input.brokerOrderId} -> status=${order.status}, cumFilled=${order.filledQty}, remaining=${order.remainingQty}`,
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
    orderType?: string;
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
      brokerOrderId: string;
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

    if (!input.brokerOrderId) {
      return { kind: "skipped", reason: "missing_order_id" };
    }

    const key = input.brokerOrderId;
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
        tradeId: `LT-${++this.tradeIdCounter}`,
        symbol: input.symbol,
        side: tradeSide,
        entryOrderId: entry?.fillId ?? "",
        exitOrderId: input.brokerOrderId,
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
      exitOrderId: input.brokerOrderId,
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
    const brokerOrderId = this.clientOrderIdIndex.get(clientOrderId);
    if (brokerOrderId) return this.orders.get(brokerOrderId);
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
  getOrderfilledQty(brokerOrderId: string): number {
    const order = this.orders.get(brokerOrderId);
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

  // ============== v2 READ METHODS ==============

  /**
   * Get all pending orders (v2 model — derives from orders map).
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
   * Get all v2 positions.
   */
  getPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get all v2 balances.
   */
  getV2Balances(): Record<string, BalanceState> {
    return Object.fromEntries(this.balances);
  }

  /**
   * Get a single v2 order by broker order ID.
   */
  getOrder(brokerOrderId: string): OrderState | undefined {
    return this.orders.get(brokerOrderId);
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
  } {
    const positionStates = this.getPositions();

    const positions: Position[] = positionStates.map((p) => {
      const absQty = Math.abs(p.quantity);
      const marketValue = absQty * p.currentPrice;
      const openCostBasis = absQty * p.avgFillPrice;
      const unrealizedPnl = (p.currentPrice - p.avgFillPrice) * p.quantity;

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

    if (this.startingEquity === null && totalEquity > 0) {
      this.startingEquity = totalEquity;
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
    };
  }

  getPosition(symbol: string): Position | null {
    const p = this.positions.get(symbol);
    if (!p) return null;

    const absQty = Math.abs(p.quantity);
    const marketValue = absQty * p.currentPrice;
    const openCostBasis = absQty * p.avgFillPrice;
    const unrealizedPnl = (p.currentPrice - p.avgFillPrice) * p.quantity;

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
    this.cashBook.set(baseCurrency, cashBalance);
    // Also set in v2 balances
    this.balances.set(baseCurrency, {
      asset: baseCurrency,
      cash: cashBalance,
      updatedAt: new Date().toISOString(),
    });
    if (this.startingEquity === null && cashBalance > 0) {
      this.startingEquity = cashBalance;
    }
    this.bootstrapped = true;
    console.log(
      `[PortfolioManager] Initialized portfolio: ${baseCurrency} = ${cashBalance}`,
    );
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
    //const now = new Date().toISOString();

    for (const [symbol, price] of Object.entries(prices)) {
      const position = this.positions.get(symbol);
      if (!position) continue;

      const absQty = Math.abs(position.quantity);

      position.currentPrice = price;
      position.marketValue = absQty * price;
      position.openCostBasis = absQty * position.avgFillPrice;
      position.unrealizedPnl =
        (position.currentPrice - position.avgFillPrice) * position.quantity;
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
