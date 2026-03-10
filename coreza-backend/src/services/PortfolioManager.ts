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
  OrderSide,
  OrderEvent,
  OrderTicket,
  isTicketPending,
} from "../types/order";

// ============== INTERFACES ==============

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

// ============== PORTFOLIO MANAGER ==============

/**
 * PortfolioManager - Pure in-memory portfolio engine for live broker mode.
 *
 * All state (fills, holdings, PnL, pending orders) lives in RAM only,
 * scoped to the workflow run. When the workflow ends, destroy() is called
 * and all state is garbage collected.
 *
 * Uses the QC Lean pattern: Order + OrderEvent + OrderTicket.
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

  // ============== PENDING ORDER LEDGER (OrderTicket-based) ==============

  /**
   * Register a pending order. Creates an Order + OrderTicket.
   * Idempotent — if orderId already exists, updates the ticket's order fields.
   */
  registerOrder(order: {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    limitPrice?: number;
  }): { registered: boolean; pending_order: OrderTicket } {
    const existing = this.tickets.get(order.orderId);
    if (existing) {
      // Update fields that may change (e.g., status re-confirmation)
      existing.order.symbol = order.symbol;
      existing.order.side = order.side.toLowerCase() as OrderSide;
      existing.order.limitPrice = order.limitPrice;
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
      orderType: order.limitPrice ? 'limit' : 'market',
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      status: 'submitted',
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
    const ticket = this.tickets.get(orderId);
    if (!ticket) {
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
      status: 'canceled',
      side: ticket.order.side,
      fillPrice: 0,
      fillQuantity: 0,
      message: 'Order cancelled',
    };
    ticket.orderEvents.push(cancelEvent);
    ticket.order.status = 'canceled';

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
      ticket.order.status = 'filled';
      this.tickets.delete(fillId);
      console.log(
        `[PortfolioManager] Pending order fully filled and removed: ${fillId}`,
      );
    } else {
      ticket.order.status = 'partially_filled';
      console.log(
        `[PortfolioManager] Pending order partially filled: ${fillId} (remaining: ${ticket.order.quantity - ticket.quantityFilled})`,
      );
    }
  }

  // ============== FILL APPLICATION (mirrors SimBroker logic) ==============

  /**
   * Apply a fill to in-memory holdings.
   * Uses the same weighted-average cost basis logic as SimBroker.applyFill().
   */
  private applyFillToHoldings(
    fill: OrderEvent,
    adjustCash: boolean = false,
    baseCurrency: string = "USDT",
  ): void {
    const fillTime = fill.utcTime;
    const signedQuantity = fill.side === "buy" ? fill.fillQuantity : -fill.fillQuantity;
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

    const closingQty = Math.min(Math.abs(existingQty), Math.abs(signedQuantity));
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

  private adjustCashBookForFill(fill: OrderEvent, adjustCash: boolean, baseCurrency: string = "USDT"): void {
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
      this.cashBook.set(baseAsset, currentBase + fill.fillQuantity - baseCommission);
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
      status: 'filled',
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
      this.fillLedger.splice(0, this.fillLedger.length - MAX_FILL_LEDGER_SIZE + 1);
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
          (ticket.averageFillPrice * ticket.quantityFilled + price * effectiveQty) /
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
