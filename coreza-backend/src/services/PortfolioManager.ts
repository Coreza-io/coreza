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

export interface PortfolioSnapshot {
  cash: Record<string, number>; // asset -> balance
  holdings: Record<string, SpotHolding>; // symbol -> holding
  trades: Trade[];
  totalValueUsdt: number;
}

// ============== PORTFOLIO MANAGER ==============

/**
 * PortfolioManager - Pure in-memory portfolio engine for live broker mode.
 *
 * All state (fills, holdings, PnL) lives in RAM only, scoped to the
 * workflow run. When the workflow ends, destroy() is called and all
 * state is garbage collected. On the next run, initializePortfolio()
 * starts from explicit cash and subsequent update_portfolio fills.
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
  private fillIdSet = new Set<string>(); // O(1) dedup: "${symbol}:${tradeId}"
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
    this.fillIdSet.clear();
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

  // ============== FILL APPLICATION (mirrors SimBroker logic) ==============

  /**
   * Apply a fill to in-memory holdings.
   * Uses the same weighted-average cost basis logic as SimBroker.applyFill().
   */
  private applyFillToHoldings(
    fill: LiveFill,
    adjustCash: boolean = false,
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

    this.adjustCashBookForFill(fill, adjustCash);
  }

  private adjustCashBookForFill(fill: LiveFill, adjustCash: boolean): void {
    if (!adjustCash) return;

    const quoteAsset = this.extractQuoteAsset(fill.symbol) ?? "USDT";
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
  ): { applied: boolean; reason?: string } {
    const { symbol, quantity, price, commission = 0 } = fill;
    const side: "BUY" | "SELL" = quantity > 0 ? "BUY" : "SELL";
    const absQty = Math.abs(quantity);

    // Deterministic dedup key: use fillId if provided, otherwise auto-generate
    const tradeId = fillId || `MANUAL-${++this.tradeIdCounter}`;
    const dedupKey = `${symbol}:${tradeId}`;

    // Check for duplicate before applying
    if (this.fillIdSet.has(dedupKey)) {
      console.log(
        `[PortfolioManager] Skipping duplicate fill: ${dedupKey}`,
      );
      return { applied: false, reason: "duplicate" };
    }

    // Convert to LiveFill and delegate to existing logic
    const liveFill: LiveFill = {
      tradeId,
      orderId: fillId,
      symbol,
      side,
      qty: absQty,
      price,
      commission,
      commissionAsset: this.extractQuoteAsset(symbol) ?? baseCurrency,
      eventTime: Date.now(),
    };

    this.fillIdSet.add(dedupKey);
    this.fillLedger.push(liveFill);
    this.applyFillToHoldings(liveFill, true);
    this.updatePeakEquity(baseCurrency);

    console.log(
      `[PortfolioManager] Applied fill: ${side} ${absQty} ${symbol} @ ${price} (commission: ${commission}, fillId: ${tradeId})`,
    );
    return { applied: true };
  }
}
