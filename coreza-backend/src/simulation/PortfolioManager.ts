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
  brokerOrderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType?: string;
  timeInForce?: string;
  status: string;
  origQty: number;
  filledQty: number;
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
  filledQty?: number;
  ts: string;
}

export interface PositionState {
  symbol: string;
  quantity: number;
  side: string;
  currentPrice: number;
  avgEntryPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openCostBasis: number;
  //updatedAt: string;
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
  }): { order: OrderState } {
    const now = new Date().toISOString();
    const order: OrderState = {
      brokerOrderId: input.brokerOrderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      timeInForce: input.timeInForce,
      status: input.status ?? "new",
      origQty: input.origQty,
      filledQty: 0,
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
    status: string;
    filledQty?: number;
    avgFillPrice?: number;
    feeAmount?: number;
    feeAsset?: string;
  }): void {
    const now = new Date().toISOString();

    const order = this.orders.get(input.brokerOrderId);
    if (!order) {
      throw new Error(
        `[PortfolioManager] applyOrderUpdate: order not found for brokerOrderId=${input.brokerOrderId}`,
      );
    }

    // Safety check: avoid silently mutating the wrong order
    if (order.symbol !== input.symbol) {
      throw new Error(
        `[PortfolioManager] applyOrderUpdate: symbol mismatch for brokerOrderId=${input.brokerOrderId}. existing=${order.symbol}, incoming=${input.symbol}`,
      );
    }

    // Apply broker lifecycle status first
    order.status = input.status;
    order.filledQty = input.filledQty || 0;
    order.avgFillPrice = input.avgFillPrice;

    // Derive remaining quantity from cumulative filled quantity
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

    order.totalFees += input.feeAmount;

    order.updatedAt = now;

    console.log(
      `[PortfolioManager] Order update: ${input.brokerOrderId} -> status=${order.status}, cumFilled=${order.filledQty}, remaining=${order.remainingQty}`,
    );
  }

  /**
   * Reconcile position with absolute broker quantity.
   * Sets the position to the exact quantity the broker reports.
   * This is where Alpaca's 0.9982 gets recorded correctly.
   */
  applyPositionUpdate(input: {
    symbol: string;
    netFilledQty: number;
    avgEntryPrice?: number;
    currentPrice?: number;
  }): { position: PositionState | null } {
    const existing = this.positions.get(input.symbol);

    if (existing) {
      const avgEntryPrice = input.avgEntryPrice ?? existing.avgEntryPrice ?? 0;

      const currentPrice =
        input.currentPrice ?? existing.currentPrice ?? avgEntryPrice;

      existing.quantity = input.netFilledQty;
      existing.avgEntryPrice = avgEntryPrice;
      existing.currentPrice = currentPrice;
      existing.openCostBasis = Math.abs(input.netFilledQty * avgEntryPrice);
      existing.marketValue = Math.abs(input.netFilledQty * currentPrice);
      existing.unrealizedPnl = existing.marketValue - existing.openCostBasis;
      existing.totalPnl = existing.realizedPnl + existing.unrealizedPnl;

      return { position: existing };
    }

    const avgEntryPrice = input.avgEntryPrice ?? 0;
    const currentPrice = input.currentPrice ?? avgEntryPrice;

    const position: PositionState = {
      symbol: input.symbol,
      quantity: input.netFilledQty,
      side: input.netFilledQty >= 0 ? "long" : "short",
      avgEntryPrice,
      currentPrice,
      openCostBasis: Math.abs(input.netFilledQty * avgEntryPrice),
      marketValue: Math.abs(input.netFilledQty * currentPrice),
      realizedPnl: 0,
      unrealizedPnl:
        Math.abs(input.netFilledQty * currentPrice) -
        Math.abs(input.netFilledQty * avgEntryPrice),
      totalPnl:
        0 +
        (Math.abs(input.netFilledQty * currentPrice) -
          Math.abs(input.netFilledQty * avgEntryPrice)),
    };

    this.positions.set(input.symbol, position);

    return { position };
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
    filledQty?: number;
    execPrice?: number;
    execQty?: number;
  }): string {
    if (input.executionId) return input.executionId;
    // Fallback composite key
    return `${input.brokerOrderId ?? "unknown"}|${input.filledQty ?? 0}|${input.execPrice ?? 0}|${input.execQty ?? 0}`;
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

  private adjustQuoteBalance(
    quoteAsset: string,
    side: "buy" | "sell",
    notional: number,
    now: string,
  ): void {
    const balance = this.balances.get(quoteAsset);
    const current = balance?.total ?? this.cashBook.get(quoteAsset) ?? 0;
    const newTotal = side === "buy" ? current - notional : current + notional;

    if (balance) {
      balance.total = newTotal;
      balance.updatedAt = now;
    } else {
      this.balances.set(quoteAsset, {
        asset: quoteAsset,
        total: newTotal,
        updatedAt: now,
      });
    }

    // Sync to legacy cashBook
    this.cashBook.set(quoteAsset, newTotal);
  }

  private adjustFeeBalance(
    feeAsset: string,
    feeAmount: number,
    now: string,
  ): void {
    const balance = this.balances.get(feeAsset);
    const current = balance?.total ?? this.cashBook.get(feeAsset) ?? 0;
    const newTotal = current - feeAmount;

    if (balance) {
      balance.total = newTotal;
      balance.updatedAt = now;
    } else {
      this.balances.set(feeAsset, {
        asset: feeAsset,
        total: newTotal,
        updatedAt: now,
      });
    }

    // Sync to legacy cashBook
    this.cashBook.set(feeAsset, newTotal);
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
    const { quoteAsset } = this.parseInstrument(input.symbol, input.baseCurrency);
    const effectiveQuoteAsset = quoteAsset ?? input.baseCurrency ?? "USD";

    const notional = input.fillPrice * input.fillQty;
    this.adjustQuoteBalance(effectiveQuoteAsset, input.side, notional, now);

    if (input.feeAmount && input.feeAmount > 0) {
      const feeBalanceAsset = input.feeAsset ?? effectiveQuoteAsset;
      this.adjustFeeBalance(feeBalanceAsset, input.feeAmount, now);
    }

    this.updatePeakEquity(input.baseCurrency);
  }

  private applyExecutionDerivedPositionDelta(
    input: {
      symbol: string;
      side: "buy" | "sell";
      execQty: number;
      execPrice: number;
      baseCurrency: string;
    },
    feeAmount: number,
    now: string,
  ): void {
    const existing = this.positions.get(input.symbol);
    const signedQty = input.side === "buy" ? input.execQty : -input.execQty;

    if (!existing) {
      // New position
      const position: PositionState = {
        symbol: input.symbol,
        quantity: signedQty,
        currentPrice: input.execPrice,
        avgEntryPrice: input.execPrice,
        realizedPnl: 0,
        openCostBasis: input.execQty * input.execPrice,
        //updatedAt: now,
      };
      this.positions.set(input.symbol, position);
      //this.syncPositionToHoldings(position);

      this.currentEntryMap.set(input.symbol, {
        fillId: `exec-${Date.now()}`,
        entryTime: now,
      });
      return;
    }

    const prevQty = existing.quantity;
    const sameDirection =
      (prevQty >= 0 && signedQty >= 0) || (prevQty <= 0 && signedQty <= 0);

    if (sameDirection) {
      // Adding to position — weighted average cost
      const totalQty = prevQty + signedQty;
      const totalCostBasis =
        existing.openCostBasis + input.execQty * input.execPrice;
      existing.avgEntryPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.openCostBasis = totalCostBasis;
      existing.currentPrice = input.execPrice;
      //existing.updatedAt = now;

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
        commission: feeAmount,
        slippage: 0,
        netPnl: grossPnl - feeAmount,
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
      if ((prevQty > 0 && newQty < 0) || (prevQty < 0 && newQty > 0)) {
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
        existing.openCostBasis = existing.avgEntryPrice * remainingQty;
      }
      //existing.updatedAt = now;
    }
  }

  // ============== v2 READ METHODS ==============

  /**
   * Get all pending orders (v2 model — derives from orders map).
   */
  getPendingOrders(): OrderState[] {
    return Array.from(this.orders.values()).filter((o) =>
      OPEN_ORDER_STATUSES.has(o.status),
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
    pendingOrders: OrderState[];
  } {
    const positionStates = this.getPositions();
    const positions: Position[] = positionStates.map((p) => ({
      symbol: p.symbol,
      side: p.side,
      quantity: p.quantity,
      avgEntryPrice: p.avgEntryPrice,
      currentPrice: p.currentPrice,
      unrealizedPnl: (p.currentPrice - p.avgEntryPrice) * p.quantity,
      realizedPnl: p.realizedPnl,
      marketValue: p.quantity * p.currentPrice,
    }));
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

  getPosition(symbol: string): Position | null {
    const p = this.positions.get(symbol);
    if (!p) return null;

    return {
      symbol: p.symbol,
      side: p.quantity >= 0 ? "long" : "short",
      quantity: p.quantity,
      avgEntryPrice: p.avgEntryPrice,
      currentPrice: p.currentPrice,
      unrealizedPnl: (p.currentPrice - p.avgEntryPrice) * p.quantity,
      realizedPnl: p.realizedPnl,
      marketValue: p.quantity * p.currentPrice,
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
    //const now = new Date().toISOString();

    for (const [symbol, price] of Object.entries(prices)) {
      const position = this.positions.get(symbol);
      if (!position) continue;

      position.currentPrice = price;
      position.marketValue = position.quantity * price;
      position.unrealizedPnl = position.marketValue - position.openCostBasis;
      position.totalPnl = position.realizedPnl + position.unrealizedPnl;
      //position.updatedAt = now;
    }

    this.updatePeakEquity(baseCurrency);
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
