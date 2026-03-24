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

import { Position, Trade } from "./simBroker/interfaces";
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
  brokerOrderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType?: string;
  timeInForce?: string;
  status: string;
  origQty: number;
  cumFilledQty: number;
  remainingQty?: number;
  avgFillPrice?: number;
  totalFees: number;
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
  cumFilledQty?: number;
  ts: string;
}

export interface PositionState {
  symbol: string;
  quantity: number;
  currentPrice: number;
  avgEntryPrice: number;
  realizedPnl: number;
  openCostBasis: number;
  lastBrokerQuantity?: number;
  updatedAt: string;
}

export interface BalanceState {
  asset: string;
  total: number;
  available?: number;
  locked?: number;
  updatedAt: string;
}

// ============== LEGACY INTERFACES ==============

export interface SpotHolding {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
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

const OPEN_ORDER_STATUSES = new Set([
  "new",
  "pending_new",
  "accepted",
  "open",
  "partially_filled",
  "pending_cancel",
  "pending_replace",
]);

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
 * One instance per (userId, runId) pair, managed via static cache.
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
  private runId: string;

  // ============== v2 STATE MAPS ==============
  private orders = new Map<string, OrderState>();
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
  private tickets = new Map<string, OrderTicket>(); // orderId → OrderTicket
  private trades: Trade[] = [];
  private currentEntryMap = new Map<
    string,
    {
      fillId: string;
      entryTime: string;
    }
  >();
  private tradeIdCounter = 0;
  private peakEquity = 0;

  private bootstrapped = false;

  private constructor(userId: string, runId: string) {
    this.userId = userId;
    this.runId = runId;
  }

  /**
   * Get or create a PortfolioManager instance for the given user/run.
   */
  static getInstance(userId: string, runId: string): PortfolioManager {
    const key = `${userId}:${runId}`;
    let instance = PortfolioManager.instances.get(key);
    if (!instance) {
      instance = new PortfolioManager(userId, runId);
      PortfolioManager.instances.set(key, instance);
    }
    return instance;
  }

  /**
   * Remove a cached instance (e.g., on run cleanup).
   */
  static removeInstance(userId: string, runId: string): void {
    PortfolioManager.instances.delete(`${userId}:${runId}`);
  }

  /**
   * Destroy this instance: clear all in-memory state and remove from cache.
   * Should be called when a workflow run ends.
   */
  destroy(): void {
    // v2 state
    this.orders.clear();
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
    this.tickets.clear();
    this.trades.length = 0;
    this.currentEntryMap.clear();
    this.tradeIdCounter = 0;
    this.peakEquity = 0;
    this.bootstrapped = false;

    PortfolioManager.instances.delete(`${this.userId}:${this.runId}`);
    console.log(
      `[PortfolioManager] Destroyed instance for user=${this.userId} run=${this.runId}`,
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
    origQty: number;
    orderType?: string;
    timeInForce?: string;
    limitPrice?: number;
    stopPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    status?: string;
  }): { registered: boolean; order: OrderState } {
    const now = new Date().toISOString();
    const existing = this.orders.get(input.brokerOrderId);

    if (existing) {
      // Upsert — update mutable fields
      existing.symbol = input.symbol;
      existing.side = input.side;
      existing.orderType = input.orderType ?? existing.orderType;
      existing.timeInForce = input.timeInForce ?? existing.timeInForce;
      existing.status = input.status ?? existing.status;
      existing.origQty = input.origQty || existing.origQty;
      if (input.clientOrderId) {
        existing.clientOrderId = input.clientOrderId;
        this.clientOrderIdIndex.set(input.clientOrderId, input.brokerOrderId);
      }
      existing.updatedAt = now;
      console.log(
        `[PortfolioManager] Updated existing order intent: ${input.brokerOrderId}`,
      );
      return { registered: true, order: existing };
    }

    const order: OrderState = {
      brokerOrderId: input.brokerOrderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      timeInForce: input.timeInForce,
      status: input.status ?? "new",
      origQty: input.origQty,
      cumFilledQty: 0,
      remainingQty: input.origQty,
      avgFillPrice: undefined,
      totalFees: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(input.brokerOrderId, order);
    if (input.clientOrderId) {
      this.clientOrderIdIndex.set(input.clientOrderId, input.brokerOrderId);
    }
    console.log(
      `[PortfolioManager] Registered order intent: ${input.side} ${input.origQty} ${input.symbol} (${input.brokerOrderId})`,
    );
    return { registered: true, order };
  }

  /**
   * Apply an order lifecycle update. Updates order status, cumulative fill qty, etc.
   * No cash/position mutation.
   */
  applyOrderUpdate(input: {
    brokerOrderId: string;
    clientOrderId?: string;
    symbol: string;
    status: string;
    origQty?: number;
    cumFilledQty?: number;
    remainingQty?: number;
    avgFillPrice?: number;
  }): { updated: boolean; order: OrderState } {
    const now = new Date().toISOString();
    let order = this.orders.get(input.brokerOrderId);

    if (!order) {
      // Auto-create if we haven't seen this order before
      order = {
        brokerOrderId: input.brokerOrderId,
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: "buy", // will be corrected by execution
        status: input.status,
        origQty: input.origQty ?? 0,
        cumFilledQty: input.cumFilledQty ?? 0,
        remainingQty: input.remainingQty,
        avgFillPrice: input.avgFillPrice,
        totalFees: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.orders.set(input.brokerOrderId, order);
      console.log(
        `[PortfolioManager] Auto-created order on update: ${input.brokerOrderId}`,
      );
    } else {
      // Update lifecycle fields
      order.status = input.status;
      if (input.cumFilledQty !== undefined) {
        order.cumFilledQty = input.cumFilledQty;
      }
      if (input.remainingQty !== undefined) {
        order.remainingQty = input.remainingQty;
      }
      if (input.avgFillPrice !== undefined) {
        order.avgFillPrice = input.avgFillPrice;
      }
      if (input.origQty !== undefined && input.origQty > 0) {
        order.origQty = input.origQty;
      }
      if (input.clientOrderId) {
        order.clientOrderId = input.clientOrderId;
      }
      order.updatedAt = now;
    }

    // Auto-derive status from cumulative qty
    if (
      order.origQty > 0 &&
      order.cumFilledQty >= order.origQty &&
      !TERMINAL_ORDER_STATUSES.has(order.status)
    ) {
      order.status = "filled";
    }

    // Compute remaining if not provided
    if (order.remainingQty === undefined && order.origQty > 0) {
      order.remainingQty = Math.max(0, order.origQty - order.cumFilledQty);
    }

    console.log(
      `[PortfolioManager] Order update: ${input.brokerOrderId} → status=${order.status}, cumFilled=${order.cumFilledQty}`,
    );
    return { updated: true, order };
  }

  /**
   * Apply an execution (trade fill). Handles:
   * - Execution deduplication by executionId
   * - Cash/quote balance adjustment
   * - Fee accounting (supports fee in any asset)
   * - Trade generation on position close/flip
   * - Optionally applies position delta (controlled by applyPositionDelta flag)
   *
   * When applyPositionDelta is false (e.g. Alpaca), use reconcilePosition() for position truth.
   * When applyPositionDelta is true (default, e.g. Binance spot), execution-derived delta is used.
   */
  applyExecution(input: {
    brokerOrderId?: string;
    executionId?: string;
    clientOrderId?: string;
    symbol: string;
    side: "buy" | "sell";
    execQty: number;
    execPrice: number;
    quoteNotional?: number;
    feeAmount?: number;
    feeAsset?: string;
    cumFilledQty?: number;
    baseCurrency: string;
    applyPositionDelta?: boolean;
  }): { applied: boolean; reason?: string; executionId?: string } {
    const execKey = this.buildExecutionKey(input);

    // Dedup check
    if (this.executionKeysSeen.has(execKey)) {
      console.log(
        `[PortfolioManager] Duplicate execution skipped: ${execKey}`,
      );
      return { applied: false, reason: "duplicate_execution", executionId: execKey };
    }
    this.executionKeysSeen.add(execKey);

    const now = new Date().toISOString();
    const feeAmount = input.feeAmount ?? 0;
    const feeAsset = input.feeAsset;
    const notional =
      input.quoteNotional ?? input.execQty * input.execPrice;
    const { quoteAsset } = this.parseInstrument(input.symbol, input.baseCurrency);
    const effectiveQuoteAsset = quoteAsset ?? input.baseCurrency;

    // Record execution
    const record: ExecutionRecord = {
      executionId: execKey,
      brokerOrderId: input.brokerOrderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      execQty: input.execQty,
      execPrice: input.execPrice,
      quoteNotional: notional,
      feeAmount,
      feeAsset,
      cumFilledQty: input.cumFilledQty,
      ts: now,
    };
    this.executions.set(execKey, record);

    // Update order totals if matching order exists
    const order =
      this.orders.get(input.brokerOrderId ?? "") ??
      (input.clientOrderId
        ? this.findOrderByClientId(input.clientOrderId)
        : undefined);
    if (order) {
      order.totalFees += feeAmount;
      order.side = input.side; // correct side if it was defaulted
      order.updatedAt = now;
    }

    // Cash/balance adjustment
    this.adjustQuoteBalance(effectiveQuoteAsset, input.side, notional);

    // Fee adjustment (supports fee in any asset)
    if (feeAmount > 0) {
      const feeBalanceAsset = feeAsset ?? effectiveQuoteAsset;
      this.adjustFeeBalance(feeBalanceAsset, feeAmount);
    }

    // Apply execution-derived position delta (opt-in, default true)
    // For Alpaca: pass false since reconcilePosition() is the source of truth
    // For Binance spot: pass true (default) since no reconcilePosition call follows
    if (input.applyPositionDelta !== false) {
      this.applyExecutionDerivedPositionDelta(input, feeAmount, now);
    }

    // Update peak equity
    this.updatePeakEquity(input.baseCurrency);

    console.log(
      `[PortfolioManager] Execution applied: ${input.side} ${input.execQty} ${input.symbol} @ ${input.execPrice} (exec=${execKey})`,
    );
    return { applied: true, executionId: execKey };
  }

  /**
   * Reconcile position with absolute broker quantity.
   * Sets the position to the exact quantity the broker reports.
   * This is where Alpaca's 0.9982 gets recorded correctly.
   */
  reconcilePosition(input: {
    symbol: string;
    positionQty: number;
    avgEntryPrice?: number;
    realizedPnl?: number;
    currentPrice?: number;
  }): { reconciled: boolean; position: PositionState | null } {
    const now = new Date().toISOString();
    const existing = this.positions.get(input.symbol);

    if (input.positionQty === 0) {
      // Position fully closed
      if (existing) {
        this.positions.delete(input.symbol);
        console.log(
          `[PortfolioManager] Position reconciled to zero: ${input.symbol}`,
        );
      }
      // Also remove from legacy holdings
      this.holdings.delete(input.symbol);
      return { reconciled: true, position: null };
    }

    if (existing) {
      // Update existing position with broker truth
      const prevQty = existing.quantity;
      existing.quantity = input.positionQty;
      existing.lastBrokerQuantity = input.positionQty;
      if (input.avgEntryPrice !== undefined) {
        existing.avgEntryPrice = input.avgEntryPrice;
        existing.openCostBasis =
          Math.abs(input.avgEntryPrice * input.positionQty);
      } else {
        // Preserve cost basis, recompute avgEntryPrice from cost basis
        if (existing.openCostBasis > 0) {
          existing.avgEntryPrice =
            existing.openCostBasis / Math.abs(input.positionQty);
        }
      }
      if (input.realizedPnl !== undefined) {
        existing.realizedPnl = input.realizedPnl;
      }
      if (input.currentPrice !== undefined) {
        existing.currentPrice = input.currentPrice;
      }
      existing.updatedAt = now;

      // Sync to legacy holdings
      this.syncPositionToHoldings(existing);

      console.log(
        `[PortfolioManager] Position reconciled: ${input.symbol} qty ${prevQty} → ${input.positionQty}`,
      );
      return { reconciled: true, position: existing };
    }

    // Create new position from broker reconciliation
    const avgEntry = input.avgEntryPrice ?? 0;
    const position: PositionState = {
      symbol: input.symbol,
      quantity: input.positionQty,
      currentPrice: input.currentPrice ?? avgEntry,
      avgEntryPrice: avgEntry,
      realizedPnl: input.realizedPnl ?? 0,
      openCostBasis: Math.abs(avgEntry * input.positionQty),
      lastBrokerQuantity: input.positionQty,
      updatedAt: now,
    };
    this.positions.set(input.symbol, position);

    // Sync to legacy holdings
    this.syncPositionToHoldings(position);

    console.log(
      `[PortfolioManager] Position created via reconciliation: ${input.symbol} qty=${input.positionQty}`,
    );
    return { reconciled: true, position };
  }

  /**
   * Reconcile a balance with broker truth (one asset per call).
   * Becomes the source of truth for getCash().
   */
  reconcileBalance(input: {
    asset: string;
    total: number;
    available?: number;
    locked?: number;
  }): { reconciled: boolean; balance: BalanceState } {
    const now = new Date().toISOString();
    const balance: BalanceState = {
      asset: input.asset,
      total: input.total,
      available: input.available,
      locked: input.locked,
      updatedAt: now,
    };
    this.balances.set(input.asset, balance);

    // Sync to legacy cashBook
    this.cashBook.set(input.asset, input.total);

    console.log(
      `[PortfolioManager] Balance reconciled: ${input.asset} total=${input.total}`,
    );
    return { reconciled: true, balance };
  }

  // ============== v2 HELPER METHODS ==============

  private buildExecutionKey(input: {
    executionId?: string;
    brokerOrderId?: string;
    cumFilledQty?: number;
    execPrice?: number;
    execQty?: number;
  }): string {
    if (input.executionId) return input.executionId;
    // Fallback composite key
    return `${input.brokerOrderId ?? "unknown"}|${input.cumFilledQty ?? 0}|${input.execPrice ?? 0}|${input.execQty ?? 0}`;
  }

  private findOrderByClientId(clientOrderId: string): OrderState | undefined {
    const brokerOrderId = this.clientOrderIdIndex.get(clientOrderId);
    if (brokerOrderId) return this.orders.get(brokerOrderId);
    return undefined;
  }

  private adjustQuoteBalance(
    quoteAsset: string,
    side: "buy" | "sell",
    notional: number,
  ): void {
    const balance = this.balances.get(quoteAsset);
    const current = balance?.total ?? this.cashBook.get(quoteAsset) ?? 0;
    const newTotal = side === "buy" ? current - notional : current + notional;

    if (balance) {
      balance.total = newTotal;
      balance.updatedAt = new Date().toISOString();
    } else {
      this.balances.set(quoteAsset, {
        asset: quoteAsset,
        total: newTotal,
        updatedAt: new Date().toISOString(),
      });
    }

    // Sync to legacy cashBook
    this.cashBook.set(quoteAsset, newTotal);
  }

  private adjustFeeBalance(feeAsset: string, feeAmount: number): void {
    const balance = this.balances.get(feeAsset);
    const current = balance?.total ?? this.cashBook.get(feeAsset) ?? 0;
    const newTotal = current - feeAmount;

    if (balance) {
      balance.total = newTotal;
      balance.updatedAt = new Date().toISOString();
    } else {
      this.balances.set(feeAsset, {
        asset: feeAsset,
        total: newTotal,
        updatedAt: new Date().toISOString(),
      });
    }

    // Sync to legacy cashBook
    this.cashBook.set(feeAsset, newTotal);
  }

  private applyExecutionDerivedPositionDelta(
    input: {
      symbol: string;
      side: "buy" | "sell";
      execQty: number;
      execPrice: number;
      baseCurrency: string;
    },
    now: string,
  ): void {
    const existing = this.positions.get(input.symbol);
    const signedQty =
      input.side === "buy" ? input.execQty : -input.execQty;

    if (!existing) {
      // New position
      const position: PositionState = {
        symbol: input.symbol,
        quantity: signedQty,
        currentPrice: input.execPrice,
        avgEntryPrice: input.execPrice,
        realizedPnl: 0,
        openCostBasis: input.execQty * input.execPrice,
        updatedAt: now,
      };
      this.positions.set(input.symbol, position);
      this.syncPositionToHoldings(position);

      this.currentEntryMap.set(input.symbol, {
        fillId: `exec-${Date.now()}`,
        entryTime: now,
      });
      return;
    }

    const prevQty = existing.quantity;
    const sameDirection =
      (prevQty >= 0 && signedQty >= 0) ||
      (prevQty <= 0 && signedQty <= 0);

    if (sameDirection) {
      // Adding to position — weighted average cost
      const totalQty = prevQty + signedQty;
      const totalCostBasis =
        existing.openCostBasis + input.execQty * input.execPrice;
      existing.avgEntryPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.openCostBasis = totalCostBasis;
      existing.currentPrice = input.execPrice;
      existing.updatedAt = now;

      if (!this.currentEntryMap.has(input.symbol)) {
        this.currentEntryMap.set(input.symbol, {
          fillId: `exec-${Date.now()}`,
          entryTime: now,
        });
      }
    } else {
      // Reducing/flipping position
      const closingQty = Math.min(Math.abs(prevQty), Math.abs(signedQty));
      const isClosingLong = prevQty > 0;
      const grossPnl = isClosingLong
        ? (input.execPrice - existing.avgEntryPrice) * closingQty
        : (existing.avgEntryPrice - input.execPrice) * closingQty;

      existing.realizedPnl += grossPnl;

      // Generate trade record
      const entry = this.currentEntryMap.get(input.symbol);
      const trade: Trade = {
        id: `LT-${++this.tradeIdCounter}`,
        symbol: input.symbol,
        side: isClosingLong ? "buy" : "sell",
        entryOrderId: entry?.fillId ?? "",
        exitOrderId: `exec-${Date.now()}`,
        entryPrice: existing.avgEntryPrice,
        exitPrice: input.execPrice,
        quantity: closingQty,
        grossPnl,
        commission: 0,
        slippage: 0,
        netPnl: grossPnl,
        entryTime: entry?.entryTime ?? "",
        exitTime: now,
        holdingPeriodBars: 0,
      };
      this.trades.push(trade);

      const newQty = prevQty + signedQty;
      if (newQty === 0) {
        this.positions.delete(input.symbol);
        this.holdings.delete(input.symbol);
        this.currentEntryMap.delete(input.symbol);
        return;
      }

      // Position flipped or reduced
      existing.quantity = newQty;
      existing.currentPrice = input.execPrice;
      if (
        (prevQty > 0 && newQty < 0) ||
        (prevQty < 0 && newQty > 0)
      ) {
        // Flipped — reset cost basis
        const remainingQty = Math.abs(newQty);
        existing.avgEntryPrice = input.execPrice;
        existing.openCostBasis = remainingQty * input.execPrice;
        this.currentEntryMap.set(input.symbol, {
          fillId: `exec-${Date.now()}`,
          entryTime: now,
        });
      } else {
        // Reduced — proportional cost basis
        const remainingQty = Math.abs(newQty);
        existing.openCostBasis =
          existing.avgEntryPrice * remainingQty;
      }
      existing.updatedAt = now;
    }

    this.syncPositionToHoldings(existing);
  }

  private syncPositionToHoldings(pos: PositionState): void {
    this.holdings.set(pos.symbol, {
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgEntryPrice: pos.avgEntryPrice,
      realizedPnl: pos.realizedPnl,
      currentPrice: pos.currentPrice,
    });
  }

  // ============== v2 READ METHODS ==============

  /**
   * Get all pending orders (v2 model — derives from orders map).
   */
  getV2PendingOrders(): OrderState[] {
    return Array.from(this.orders.values()).filter((o) =>
      OPEN_ORDER_STATUSES.has(o.status),
    );
  }

  /**
   * Get all v2 positions.
   */
  getV2Positions(): PositionState[] {
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

  // ============== LEGACY PENDING ORDER LEDGER (OrderTicket-based) ==============

  /**
   * Register a pending order. Creates an Order + OrderTicket.
   * Idempotent — if orderId already exists, updates the ticket's order fields.
   * @deprecated Use registerOrderIntent() for new code
   */
  registerOrder(order: {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side: OrderSide;
    quantity: number;
    orderType: OrderType;
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: string;
    trailPercent?: number;
    trailPrice?: number;
    status: OrderStatus;
  }): { registered: boolean; pending_order: OrderTicket } {
    // Also register in v2 model
    this.registerOrderIntent({
      brokerOrderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side.toLowerCase() as "buy" | "sell",
      origQty: order.quantity,
      orderType: order.orderType,
      timeInForce: order.timeInForce,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      trailPercent: order.trailPercent,
      trailPrice: order.trailPrice,
      status: order.status,
    });

    const existing = this.tickets.get(order.orderId);
    if (existing) {
      existing.order.symbol = order.symbol;
      existing.order.side = order.side.toLowerCase() as OrderSide;
      existing.order.limitPrice = order.limitPrice;
      existing.order.stopPrice = order.stopPrice;
      existing.order.timeInForce = order.timeInForce;
      existing.order.trailPercent = order.trailPercent;
      existing.order.trailPrice = order.trailPrice;
      console.log(
        `[PortfolioManager] Updated existing pending order: ${order.orderId}`,
      );
      return { registered: true, pending_order: existing };
    }

    const o: Order = {
      id: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side.toLowerCase() as OrderSide,
      orderType: order.orderType,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
      trailPercent: order.trailPercent,
      trailPrice: order.trailPrice,
      status: order.status,
      createdAt: new Date().toISOString(),
    };

    const ticket: OrderTicket = {
      orderId: order.orderId,
      order: o,
      orderEvents: [],
      quantityFilled: 0,
      averageFillPrice: 0,
      totalFees: 0,
    };

    this.tickets.set(order.orderId, ticket);
    console.log(
      `[PortfolioManager] Registered pending order: ${order.side} ${order.quantity} ${order.symbol} (${order.orderId})`,
    );
    return { registered: true, pending_order: ticket };
  }

  /**
   * Cancel/remove a pending order by orderId.
   * Appends a cancel OrderEvent to the ticket.
   */
  cancelOrder(orderId: string): { removed: boolean; order?: OrderTicket } {
    // Also cancel in v2 model
    const v2Order = this.orders.get(orderId);
    if (v2Order) {
      v2Order.status = "canceled";
      v2Order.updatedAt = new Date().toISOString();
      // Keep in orders map for audit — getV2PendingOrders() already filters by OPEN_ORDER_STATUSES
    }

    const ticket = this.tickets.get(orderId);
    if (!ticket) {
      if (v2Order) {
        console.log(
          `[PortfolioManager] Cancel: v2 order cancelled for ${orderId}`,
        );
        return { removed: true };
      }
      console.log(
        `[PortfolioManager] Cancel: no pending order found for ${orderId}`,
      );
      return { removed: false };
    }

    // Append cancel event
    const cancelEvent: OrderEvent = {
      orderId,
      symbol: ticket.order.symbol,
      utcTime: new Date().toISOString(),
      status: "canceled",
      side: ticket.order.side,
      fillPrice: 0,
      fillQuantity: 0,
      message: "Order cancelled",
    };
    ticket.orderEvents.push(cancelEvent);
    ticket.order.status = "canceled";

    this.tickets.delete(orderId);
    console.log(
      `[PortfolioManager] Cancelled pending order: ${orderId} (${ticket.order.side} ${ticket.order.quantity} ${ticket.order.symbol})`,
    );
    return { removed: true, order: ticket };
  }

  /**
   * Get all pending order tickets as an array.
   */
  getPendingOrders(): OrderTicket[] {
    return Array.from(this.tickets.values()).filter(isTicketPending);
  }

  /**
   * Get a single pending order ticket by orderId.
   */
  getPendingOrder(orderId: string): OrderTicket | null {
    return this.tickets.get(orderId) ?? null;
  }

  /**
   * Auto-decrement pending order when a fill is applied.
   * Called internally by applyFill().
   */
  private updatePendingOrderOnFill(fillId: string, deltaQty: number): void {
    const ticket = this.tickets.get(fillId);
    if (!ticket) return;

    ticket.quantityFilled += deltaQty;

    if (ticket.quantityFilled >= ticket.order.quantity) {
      ticket.order.status = "filled";
      this.tickets.delete(fillId);
      console.log(
        `[PortfolioManager] Pending order fully filled and removed: ${fillId}`,
      );
    } else {
      ticket.order.status = "partially_filled";
      console.log(
        `[PortfolioManager] Pending order partially filled: ${fillId} (remaining: ${ticket.order.quantity - ticket.quantityFilled})`,
      );
    }
  }

  // ============== LEGACY FILL APPLICATION (mirrors SimBroker logic) ==============

  /**
   * Apply a fill to in-memory holdings.
   * Uses the same weighted-average cost basis logic as SimBroker.applyFill().
   * @deprecated Use applyExecution() for new code
   */
  private applyFillToHoldings(
    fill: OrderEvent,
    adjustCash: boolean = false,
    baseCurrency: string = "USDT",
  ): void {
    const fillTime = fill.utcTime;
    const signedQuantity =
      fill.side === "buy" ? fill.fillQuantity : -fill.fillQuantity;
    const existing = this.holdings.get(fill.symbol);

    if (!existing) {
      this.holdings.set(fill.symbol, {
        symbol: fill.symbol,
        quantity: signedQuantity,
        avgEntryPrice: fill.fillPrice,
        realizedPnl: 0,
        currentPrice: fill.fillPrice,
      });
      this.currentEntryMap.set(fill.symbol, {
        fillId: fill.orderId,
        entryTime: fillTime,
      });
      this.adjustCashBookForFill(fill, adjustCash);
      return;
    }

    const existingQty = existing.quantity;
    const sameDirection =
      (existingQty >= 0 && signedQuantity >= 0) ||
      (existingQty <= 0 && signedQuantity <= 0);

    if (sameDirection) {
      const totalQty = existingQty + signedQuantity;
      const totalCostBasis =
        existing.avgEntryPrice * Math.abs(existingQty) +
        fill.fillPrice * Math.abs(signedQuantity);

      existing.avgEntryPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.currentPrice = fill.fillPrice;

      if (!this.currentEntryMap.has(fill.symbol)) {
        this.currentEntryMap.set(fill.symbol, {
          fillId: fill.orderId,
          entryTime: fillTime,
        });
      }
      this.adjustCashBookForFill(fill, adjustCash);
      return;
    }

    const closingQty = Math.min(
      Math.abs(existingQty),
      Math.abs(signedQuantity),
    );
    const isClosingLong = existingQty > 0;
    const commission = fill.orderFee?.value ?? 0;
    const grossPnl = isClosingLong
      ? (fill.fillPrice - existing.avgEntryPrice) * closingQty
      : (existing.avgEntryPrice - fill.fillPrice) * closingQty;
    const commissionForClose =
      commission * (closingQty / Math.abs(signedQuantity));
    const netPnl = grossPnl - commissionForClose;
    const entry = this.currentEntryMap.get(fill.symbol);

    existing.realizedPnl += netPnl;

    const trade: Trade = {
      id: `LT-${++this.tradeIdCounter}`,
      symbol: fill.symbol,
      side: isClosingLong ? "buy" : "sell",
      entryOrderId: entry?.fillId ?? "",
      exitOrderId: fill.orderId,
      entryPrice: existing.avgEntryPrice,
      exitPrice: fill.fillPrice,
      quantity: closingQty,
      grossPnl,
      commission: commissionForClose,
      slippage: 0,
      netPnl,
      entryTime: entry?.entryTime ?? "",
      exitTime: fillTime,
      holdingPeriodBars: 0,
    };
    this.trades.push(trade);

    const newQty = existingQty + signedQuantity;
    if (newQty === 0) {
      this.holdings.delete(fill.symbol);
      this.currentEntryMap.delete(fill.symbol);
      this.adjustCashBookForFill(fill, adjustCash);
      return;
    }

    const flippedDirection =
      (existingQty > 0 && newQty < 0) || (existingQty < 0 && newQty > 0);

    existing.quantity = newQty;
    existing.currentPrice = fill.fillPrice;
    if (flippedDirection) {
      existing.avgEntryPrice = fill.fillPrice;
      this.currentEntryMap.set(fill.symbol, {
        fillId: fill.orderId,
        entryTime: fillTime,
      });
    }

    this.adjustCashBookForFill(fill, adjustCash, baseCurrency);
  }

  private adjustCashBookForFill(
    fill: OrderEvent,
    adjustCash: boolean,
    baseCurrency: string = "USDT",
  ): void {
    if (!adjustCash) return;

    const quoteAsset = this.extractQuoteAsset(fill.symbol) ?? baseCurrency;
    const cashImpact = fill.fillPrice * fill.fillQuantity;
    const commission = fill.orderFee?.value ?? 0;
    const commissionCurrency = fill.orderFee?.currency;
    const quoteCommission = commissionCurrency === quoteAsset ? commission : 0;
    const currentQuote = this.cashBook.get(quoteAsset) ?? 0;

    if (fill.side === "buy") {
      this.cashBook.set(
        quoteAsset,
        currentQuote - cashImpact - quoteCommission,
      );
    } else {
      this.cashBook.set(
        quoteAsset,
        currentQuote + cashImpact - quoteCommission,
      );
    }

    const baseAsset = this.extractBaseAsset(fill.symbol);
    if (!baseAsset) return;

    const currentBase = this.cashBook.get(baseAsset) ?? 0;
    if (fill.side === "buy") {
      const baseCommission = commissionCurrency === baseAsset ? commission : 0;
      this.cashBook.set(
        baseAsset,
        currentBase + fill.fillQuantity - baseCommission,
      );
    } else {
      this.cashBook.set(baseAsset, currentBase - fill.fillQuantity);
    }
  }

  private extractQuoteAsset(symbol: string): string | null {
    for (const quote of PortfolioManager.SYMBOL_QUOTE_SUFFIXES) {
      if (symbol.endsWith(quote)) {
        return quote;
      }
    }
    return null;
  }

  private extractBaseAsset(symbol: string): string | null {
    const quoteAsset = this.extractQuoteAsset(symbol);
    if (!quoteAsset) return null;

    const baseAsset = symbol.slice(0, -quoteAsset.length);
    return baseAsset || null;
  }

  // ============== PEAK EQUITY ==============

  private updatePeakEquity(baseCurrency: string = "USDT"): void {
    const currentEquity = this.getTotalEquity(baseCurrency);
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
    pendingOrders: OrderTicket[];
  } {
    const positions = this.getPositions();
    const cashBase = this.cashBook.get(baseCurrency) ?? 0;
    const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalEquity = cashBase + positionsValue;

    return {
      cash: Object.fromEntries(this.cashBook),
      positions,
      trades: this.trades,
      totalEquity,
      peakEquity: this.peakEquity,
      pendingOrders: this.getPendingOrders(),
    };
  }

  /**
   * Convert internal holdings to Position[] (same shape as SimBroker).
   */
  getPositions(): Position[] {
    return Array.from(this.holdings.values()).map((h) => ({
      symbol: h.symbol,
      side: h.quantity >= 0 ? ("long" as const) : ("short" as const),
      quantity: h.quantity,
      avgEntryPrice: h.avgEntryPrice,
      currentPrice: h.currentPrice,
      unrealizedPnl: (h.currentPrice - h.avgEntryPrice) * h.quantity,
      realizedPnl: h.realizedPnl,
      marketValue: h.quantity * h.currentPrice,
    }));
  }

  getPosition(symbol: string): Position | null {
    const h = this.holdings.get(symbol);
    if (!h) return null;

    return {
      symbol: h.symbol,
      side: h.quantity >= 0 ? "long" : "short",
      quantity: h.quantity,
      avgEntryPrice: h.avgEntryPrice,
      currentPrice: h.currentPrice,
      unrealizedPnl: (h.currentPrice - h.avgEntryPrice) * h.quantity,
      realizedPnl: h.realizedPnl,
      marketValue: h.quantity * h.currentPrice,
    };
  }

  getCash(): Record<string, number> {
    return Object.fromEntries(this.cashBook);
  }

  getTotalEquity(baseCurrency: string = "USDT"): number {
    const cashBase = this.cashBook.get(baseCurrency) ?? 0;
    const posValue = Array.from(this.holdings.values()).reduce(
      (s, h) => s + h.quantity * h.currentPrice,
      0,
    );
    return cashBase + posValue;
  }

  getPeakEquity(): number {
    return this.peakEquity;
  }

  getTrades(): Trade[] {
    return this.trades;
  }

  getFills(): OrderEvent[] {
    return this.fillLedger;
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
      total: cashBalance,
      updatedAt: new Date().toISOString(),
    });
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
    for (const [symbol, price] of Object.entries(prices)) {
      const holding = this.holdings.get(symbol);
      if (holding) {
        holding.currentPrice = price;
      }
      // Also update v2 positions
      const position = this.positions.get(symbol);
      if (position) {
        position.currentPrice = price;
      }
    }
    this.updatePeakEquity(baseCurrency);
  }

  // ============== LEGACY APPLY FILL (Accounting Loop) ==============

  /**
   * Apply a fill from explicit symbol/quantity/price/commission fields.
   * Positive quantity = BUY, negative = SELL.
   * Updates holdings (qty, avg price, realized PnL) and cash.
   * Auto-decrements matching pending order if fillId matches an orderId.
   * @deprecated Use applyExecution() for new code
   */
  applyFill(
    fill: {
      symbol: string;
      quantity: number;
      price: number;
      orderStatus: OrderStatus;
      commission?: number;
    },
    baseCurrency: string,
    fillId?: string,
  ): { applied: boolean; reason?: string; deltaQty?: number } {
    const { symbol, quantity, price, orderStatus, commission = 0 } = fill;
    const side: OrderSide = quantity > 0 ? "buy" : "sell";
    const absQty = Math.abs(quantity);

    let effectiveQty = absQty;

    if (fillId) {
      // Delta-based partial fill tracking:
      // absQty is the cumulative filled quantity for this orderId.
      // We only apply the increment since the last update.
      const previousCumQty = this.orderCumQtyMap.get(fillId) || 0;
      const delta = absQty - previousCumQty;

      if (delta <= 0) {
        console.log(
          `[PortfolioManager] No new fill quantity for ${fillId}: cum=${absQty}, prev=${previousCumQty}`,
        );
        return { applied: false, reason: "no_new_fill", deltaQty: 0 };
      }

      effectiveQty = delta;
      this.orderCumQtyMap.set(fillId, absQty);
    }
    // Manual fills (no fillId) have no natural dedup key — always apply

    const commissionCurrency = this.extractQuoteAsset(symbol) ?? baseCurrency;

    // Create OrderEvent (append-only)
    const orderEvent: OrderEvent = {
      orderId: fillId || `MANUAL-${++this.tradeIdCounter}`,
      symbol,
      utcTime: new Date().toISOString(),
      status: orderStatus,
      side,
      fillPrice: price,
      fillQuantity: effectiveQty,
      orderFee: {
        value: commission,
        currency: commissionCurrency,
      },
    };

    // Cap fill ledger to prevent unbounded memory growth
    if (this.fillLedger.length >= MAX_FILL_LEDGER_SIZE) {
      this.fillLedger.splice(
        0,
        this.fillLedger.length - MAX_FILL_LEDGER_SIZE + 1,
      );
    }
    this.fillLedger.push(orderEvent);

    // Append event to ticket if one exists
    const ticket = this.tickets.get(fillId ?? "");
    if (ticket) {
      ticket.orderEvents.push(orderEvent);
      // averageFillPrice and totalFees updated by updatePendingOrderOnFill
      ticket.totalFees += commission;
      if (ticket.quantityFilled > 0) {
        ticket.averageFillPrice =
          (ticket.averageFillPrice * ticket.quantityFilled +
            price * effectiveQty) /
          (ticket.quantityFilled + effectiveQty);
      } else {
        ticket.averageFillPrice = price;
      }
    }

    this.applyFillToHoldings(orderEvent, true, baseCurrency);
    this.updatePeakEquity(baseCurrency);

    // Auto-decrement pending order if fillId matches
    if (fillId) {
      this.updatePendingOrderOnFill(fillId, effectiveQty);
    }

    console.log(
      `[PortfolioManager] Applied fill: ${side} ${effectiveQty} ${symbol} @ ${price} (delta from cum ${absQty}, fillId: ${fillId || orderEvent.orderId})`,
    );
    return { applied: true, deltaQty: effectiveQty };
  }
}
