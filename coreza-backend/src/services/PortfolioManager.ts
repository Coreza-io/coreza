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

// ============== INTERFACES ==============

export interface SpotHolding {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  realizedPnl: number;
  currentPrice: number;
}

export interface LiveFill {
  tradeId: string;
  orderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  quoteQty?: number;
  commission: number;
  commissionAsset?: string;
  eventTime: number; // epoch ms
}

export interface PendingOrder {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  originalQty: number;
  filledQty: number;      // cumulative filled so far
  remainingQty: number;
  limitPrice?: number;
  status: "pending" | "partially_filled";
  registeredAt: number;    // epoch ms
}

export interface PortfolioSnapshot {
  cash: Record<string, number>; // asset -> balance
  holdings: Record<string, SpotHolding>; // symbol -> holding
  trades: Trade[];
  totalValueUsdt: number;
}

// ============== CONSTANTS ==============

const MAX_FILL_LEDGER_SIZE = 10_000;

// ============== PORTFOLIO MANAGER ==============

/**
 * PortfolioManager - Pure in-memory portfolio engine for live broker mode.
 *
 * All state (fills, holdings, PnL, pending orders) lives in RAM only,
 * scoped to the workflow run. When the workflow ends, destroy() is called
 * and all state is garbage collected.
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

  // In-memory state (scoped to workflow run)
  private cashBook = new Map<string, number>(); // asset -> total balance
  private holdings = new Map<string, SpotHolding>(); // symbol -> holding
  private fillLedger: LiveFill[] = [];
  private orderCumQtyMap = new Map<string, number>(); // orderId → cumulative qty applied (partial fill tracking)
  private pendingOrders = new Map<string, PendingOrder>(); // orderId → pending order
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
    this.cashBook.clear();
    this.holdings.clear();
    this.fillLedger.length = 0;
    this.orderCumQtyMap.clear();
    this.pendingOrders.clear();
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

  // ============== PENDING ORDER LEDGER ==============

  /**
   * Register a pending order. Idempotent — if orderId already exists, updates it.
   */
  registerOrder(order: {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    limitPrice?: number;
  }): { registered: boolean; pending_order: PendingOrder } {
    const existing = this.pendingOrders.get(order.orderId);
    if (existing) {
      // Update fields that may change (e.g., status re-confirmation)
      existing.symbol = order.symbol;
      existing.side = order.side;
      existing.limitPrice = order.limitPrice;
      console.log(
        `[PortfolioManager] Updated existing pending order: ${order.orderId}`,
      );
      return { registered: true, pending_order: existing };
    }

    const pending: PendingOrder = {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      originalQty: order.quantity,
      filledQty: 0,
      remainingQty: order.quantity,
      limitPrice: order.limitPrice,
      status: "pending",
      registeredAt: Date.now(),
    };

    this.pendingOrders.set(order.orderId, pending);
    console.log(
      `[PortfolioManager] Registered pending order: ${order.side} ${order.quantity} ${order.symbol} (${order.orderId})`,
    );
    return { registered: true, pending_order: pending };
  }

  /**
   * Cancel/remove a pending order by orderId.
   */
  cancelOrder(orderId: string): { removed: boolean; order?: PendingOrder } {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      console.log(
        `[PortfolioManager] Cancel: no pending order found for ${orderId}`,
      );
      return { removed: false };
    }
    this.pendingOrders.delete(orderId);
    console.log(
      `[PortfolioManager] Cancelled pending order: ${orderId} (${order.side} ${order.originalQty} ${order.symbol})`,
    );
    return { removed: true, order };
  }

  /**
   * Get all pending orders as an array.
   */
  getPendingOrders(): PendingOrder[] {
    return Array.from(this.pendingOrders.values());
  }

  /**
   * Get a single pending order by orderId.
   */
  getPendingOrder(orderId: string): PendingOrder | null {
    return this.pendingOrders.get(orderId) ?? null;
  }

  /**
   * Auto-decrement pending order when a fill is applied.
   * Called internally by applyFill().
   */
  private updatePendingOrderOnFill(fillId: string, deltaQty: number): void {
    const pending = this.pendingOrders.get(fillId);
    if (!pending) return;

    pending.filledQty += deltaQty;
    pending.remainingQty = Math.max(0, pending.originalQty - pending.filledQty);

    if (pending.remainingQty <= 0) {
      this.pendingOrders.delete(fillId);
      console.log(
        `[PortfolioManager] Pending order fully filled and removed: ${fillId}`,
      );
    } else {
      pending.status = "partially_filled";
      console.log(
        `[PortfolioManager] Pending order partially filled: ${fillId} (remaining: ${pending.remainingQty})`,
      );
    }
  }

  // ============== FILL APPLICATION (mirrors SimBroker logic) ==============

  /**
   * Apply a fill to in-memory holdings.
   * Uses the same weighted-average cost basis logic as SimBroker.applyFill().
   */
  private applyFillToHoldings(
    fill: LiveFill,
    adjustCash: boolean = false,
    baseCurrency: string = "USDT",
  ): void {
    const fillTime = new Date(fill.eventTime).toISOString();
    const signedQuantity = fill.side === "BUY" ? fill.qty : -fill.qty;
    const existing = this.holdings.get(fill.symbol);

    if (!existing) {
      this.holdings.set(fill.symbol, {
        symbol: fill.symbol,
        quantity: signedQuantity,
        avgEntryPrice: fill.price,
        realizedPnl: 0,
        currentPrice: fill.price,
      });
      this.currentEntryMap.set(fill.symbol, {
        fillId: fill.tradeId,
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
        fill.price * Math.abs(signedQuantity);

      existing.avgEntryPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.currentPrice = fill.price;

      if (!this.currentEntryMap.has(fill.symbol)) {
        this.currentEntryMap.set(fill.symbol, {
          fillId: fill.tradeId,
          entryTime: fillTime,
        });
      }
      this.adjustCashBookForFill(fill, adjustCash);
      return;
    }

    const closingQty = Math.min(Math.abs(existingQty), Math.abs(signedQuantity));
    const isClosingLong = existingQty > 0;
    const grossPnl = isClosingLong
      ? (fill.price - existing.avgEntryPrice) * closingQty
      : (existing.avgEntryPrice - fill.price) * closingQty;
    const commissionForClose =
      fill.commission * (closingQty / Math.abs(signedQuantity));
    const netPnl = grossPnl - commissionForClose;
    const entry = this.currentEntryMap.get(fill.symbol);

    existing.realizedPnl += netPnl;

    const trade: Trade = {
      id: `LT-${++this.tradeIdCounter}`,
      symbol: fill.symbol,
      side: isClosingLong ? "buy" : "sell",
      entryOrderId: entry?.fillId ?? "",
      exitOrderId: fill.tradeId,
      entryPrice: existing.avgEntryPrice,
      exitPrice: fill.price,
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
    existing.currentPrice = fill.price;
    if (flippedDirection) {
      existing.avgEntryPrice = fill.price;
      this.currentEntryMap.set(fill.symbol, {
        fillId: fill.tradeId,
        entryTime: fillTime,
      });
    }

    this.adjustCashBookForFill(fill, adjustCash, baseCurrency);
  }

  private adjustCashBookForFill(fill: LiveFill, adjustCash: boolean, baseCurrency: string = "USDT"): void {
    if (!adjustCash) return;

    const quoteAsset = this.extractQuoteAsset(fill.symbol) ?? baseCurrency;
    const cashImpact = fill.quoteQty ?? fill.price * fill.qty;
    const quoteCommission =
      fill.commissionAsset === quoteAsset ? fill.commission : 0;
    const currentQuote = this.cashBook.get(quoteAsset) ?? 0;

    if (fill.side === "BUY") {
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
    if (fill.side === "BUY") {
      const baseCommission =
        fill.commissionAsset === baseAsset ? fill.commission : 0;
      this.cashBook.set(baseAsset, currentBase + fill.qty - baseCommission);
    } else {
      this.cashBook.set(baseAsset, currentBase - fill.qty);
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
    pendingOrders: PendingOrder[];
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

  getFills(): LiveFill[] {
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
    }
    this.updatePeakEquity(baseCurrency);
  }

  // ============== APPLY FILL (Accounting Loop) ==============

  /**
   * Apply a fill from explicit symbol/quantity/price/commission fields.
   * Positive quantity = BUY, negative = SELL.
   * Updates holdings (qty, avg price, realized PnL) and cash.
   * Auto-decrements matching pending order if fillId matches an orderId.
   */
  applyFill(
    fill: {
      symbol: string;
      quantity: number;
      price: number;
      commission?: number;
    },
    baseCurrency: string,
    fillId?: string,
  ): { applied: boolean; reason?: string; deltaQty?: number } {
    const { symbol, quantity, price, commission = 0 } = fill;
    const side: "BUY" | "SELL" = quantity > 0 ? "BUY" : "SELL";
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

    // Unique tradeId for ledger: append cumulative qty to distinguish partial fills
    const tradeId = fillId ? `${fillId}-${absQty}` : `MANUAL-${++this.tradeIdCounter}`;

    const liveFill: LiveFill = {
      tradeId,
      orderId: fillId,
      symbol,
      side,
      qty: effectiveQty,
      price,
      // Commission from broker is per-event, not cumulative — use directly
      commission,
      commissionAsset: this.extractQuoteAsset(symbol) ?? baseCurrency,
      eventTime: Date.now(),
    };

    // Cap fill ledger to prevent unbounded memory growth
    if (this.fillLedger.length >= MAX_FILL_LEDGER_SIZE) {
      this.fillLedger.splice(0, this.fillLedger.length - MAX_FILL_LEDGER_SIZE + 1);
    }
    this.fillLedger.push(liveFill);

    this.applyFillToHoldings(liveFill, true, baseCurrency);
    this.updatePeakEquity(baseCurrency);

    // Auto-decrement pending order if fillId matches
    if (fillId) {
      this.updatePendingOrderOnFill(fillId, effectiveQty);
    }

    console.log(
      `[PortfolioManager] Applied fill: ${side} ${effectiveQty} ${symbol} @ ${price} (delta from cum ${absQty}, fillId: ${fillId || tradeId})`,
    );
    return { applied: true, deltaQty: effectiveQty };
  }
}
