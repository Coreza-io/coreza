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

import axios from "axios";
import { Position, Trade } from "./simBroker/interfaces";
import { signHmacSha256 } from "../utils/crypto";
import { getBinanceTimestamp } from "../utils/binanceTimeSync";

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
 * state is garbage collected. On the next run, bootstrap() re-initializes
 * fresh from the broker API.
 *
 * One instance per (userId, credentialId) pair, managed via static cache.
 */
export class PortfolioManager {
  private static instances = new Map<string, PortfolioManager>();
  private static readonly DISCOVERY_QUOTE_ASSETS = new Set([
    "USDT",
    "USDC",
    "BUSD",
    "FDUSD",
    "TUSD",
    "USD",
    "EUR",
    "GBP",
    "BNB",
  ]);
  private static readonly SYMBOL_QUOTE_SUFFIXES = [
    "USDT",
    "USDC",
    "BUSD",
    "FDUSD",
  ];

  private userId: string;
  private broker: string;
  private credentialId: string;

  // In-memory state (scoped to workflow run)
  private cashBook = new Map<string, number>(); // asset -> total balance
  private holdings = new Map<string, SpotHolding>(); // symbol -> holding
  private fillLedger: LiveFill[] = [];
  private fillIdSet = new Set<string>(); // O(1) dedup: "${symbol}:${tradeId}"
  private trades: Trade[] = [];
  private lastSyncedTradeId = new Map<string, number>(); // symbol -> last trade_id
  private trackedSymbols = new Set<string>(); // symbols synced so far
  private tradeIdCounter = 0;
  private peakEquity = 0;

  private bootstrapped = false;

  private constructor(userId: string, broker: string, credentialId: string) {
    this.userId = userId;
    this.broker = broker;
    this.credentialId = credentialId;
  }

  /**
   * Get or create a PortfolioManager instance for the given user/credential.
   */
  static getInstance(
    userId: string,
    broker: string,
    credentialId: string,
  ): PortfolioManager {
    const key = `${userId}:${credentialId}`;
    let instance = PortfolioManager.instances.get(key);
    if (!instance) {
      instance = new PortfolioManager(userId, broker, credentialId);
      PortfolioManager.instances.set(key, instance);
    }
    return instance;
  }

  /**
   * Remove a cached instance (e.g., on credential change or cleanup).
   */
  static removeInstance(userId: string, credentialId: string): void {
    PortfolioManager.instances.delete(`${userId}:${credentialId}`);
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
    this.lastSyncedTradeId.clear();
    this.trackedSymbols.clear();
    this.tradeIdCounter = 0;
    this.peakEquity = 0;
    this.bootstrapped = false;

    PortfolioManager.instances.delete(`${this.userId}:${this.credentialId}`);
    console.log(
      `[PortfolioManager] Destroyed instance for user=${this.userId} cred=${this.credentialId}`,
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

  // ============== BOOTSTRAP ==============

  /**
   * Bootstrap portfolio from broker API (pure in-memory).
   * 1. Fetch cash balances from Binance /api/v3/account (SIGNED)
   * 2. Fetch recent fills from /api/v3/myTrades (SIGNED) per symbol
   * 3. Replay fills in-memory to derive avg entry and realized PnL
   */
  async bootstrap(
    baseUrl: string,
    headers: Record<string, string>,
    creds: any,
    symbols: string[],
    environment: "live" | "testnet" = "live",
  ): Promise<void> {
    if (this.bootstrapped) return;

    console.log(
      `[PortfolioManager] Bootstrapping for ${this.broker} user=${this.userId}`,
    );

    // 1. Fetch cash balances from broker (SIGNED)
    await this.fetchCashBalances(baseUrl, headers, creds, environment);

    for (const symbol of symbols) {
      await this.syncSymbolTrades(baseUrl, headers, creds, symbol, environment);
    }

    this.updatePeakEquity();
    this.bootstrapped = true;
    console.log(
      `[PortfolioManager] Bootstrap complete: ${this.holdings.size} holdings, ${this.fillLedger.length} fills`,
    );
  }

  /**
   * Fetch cash balances from Binance Spot /api/v3/account (SIGNED endpoint).
   */
  private async fetchCashBalances(
    baseUrl: string,
    headers: Record<string, string>,
    creds: any,
    environment: "live" | "testnet",
  ): Promise<void> {
    try {
      const timestamp = getBinanceTimestamp(environment, "spot");
      const signedParams = signHmacSha256(
        { recvWindow: 5000, timestamp },
        creds.secret_key,
      );

      const response = await axios.get(`${baseUrl}/api/v3/account`, {
        headers,
        params: signedParams,
        timeout: 15000,
      });

      const balances = response.data?.balances;
      if (Array.isArray(balances)) {
        for (const bal of balances) {
          const total =
            parseFloat(bal.free || "0") + parseFloat(bal.locked || "0");
          if (total > 0) {
            this.cashBook.set(bal.asset, total);
          }
        }
      }

      console.log(
        `[PortfolioManager] Loaded ${this.cashBook.size} cash balances`,
      );
    } catch (err) {
      console.error("[PortfolioManager] Failed to fetch cash balances:", err);
    }
  }

  // ============== SYNC ==============

  /**
   * Ensure a symbol is tracked. If not yet synced, fetch its trades.
   */
  async ensureSymbolTracked(
    baseUrl: string,
    headers: Record<string, string>,
    creds: any,
    symbol: string,
    environment: "live" | "testnet" = "live",
  ): Promise<void> {
    if (this.trackedSymbols.has(symbol)) return;
    await this.syncSymbolTrades(baseUrl, headers, creds, symbol, environment);
  }

  /**
   * Incremental sync: fetch new trades from broker for a symbol (SIGNED).
   * Fills are stored in-memory only — no DB persistence.
   */
  async syncSymbolTrades(
    baseUrl: string,
    headers: Record<string, string>,
    creds: any,
    symbol: string,
    environment: "live" | "testnet",
  ): Promise<number> {
    try {
      this.trackedSymbols.add(symbol);

      const fromId = this.lastSyncedTradeId.get(symbol);
      const rawParams: Record<string, any> = { symbol };
      if (fromId) {
        rawParams.fromId = fromId + 1; // Binance fromId is inclusive
      }

      const timestamp = getBinanceTimestamp(environment, "spot");
      rawParams.recvWindow = 5000;
      rawParams.timestamp = timestamp;
      const signedParams = signHmacSha256(rawParams, creds.secret_key);

      const response = await axios.get(`${baseUrl}/api/v3/myTrades`, {
        headers,
        params: signedParams,
        timeout: 15000,
      });

      const trades = response.data;
      if (!Array.isArray(trades) || trades.length === 0) return 0;

      let newCount = 0;
      for (const t of trades) {
        const tradeId = String(t.id);
        const dedupKey = `${symbol}:${tradeId}`;

        // O(1) dedup
        if (this.fillIdSet.has(dedupKey)) continue;

        const fill: LiveFill = {
          tradeId,
          orderId: String(t.orderId),
          symbol,
          side: t.isBuyer ? "BUY" : "SELL",
          qty: parseFloat(t.qty),
          price: parseFloat(t.price),
          quoteQty: t.quoteQty ? parseFloat(t.quoteQty) : undefined,
          commission: parseFloat(t.commission),
          commissionAsset: t.commissionAsset,
          eventTime: t.time,
        };

        this.fillIdSet.add(dedupKey);
        this.fillLedger.push(fill);
        this.applyFillToHoldings(fill, this.bootstrapped);
        newCount++;

        const idNum = parseInt(tradeId, 10);
        const currentMax = this.lastSyncedTradeId.get(symbol) ?? 0;
        if (idNum > currentMax) {
          this.lastSyncedTradeId.set(symbol, idNum);
        }
      }

      if (newCount > 0) {
        this.updatePeakEquity();
        console.log(
          `[PortfolioManager] Synced ${newCount} new trades for ${symbol}`,
        );
      }

      return newCount;
    } catch (err) {
      console.error(
        `[PortfolioManager] Failed to sync trades for ${symbol}:`,
        err,
      );
      return 0;
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
  ): void {
    const existing = this.holdings.get(fill.symbol);

    if (!existing) {
      // New position
      if (fill.side === "BUY") {
        this.holdings.set(fill.symbol, {
          symbol: fill.symbol,
          quantity: fill.qty,
          avgEntryPrice: fill.price,
          realizedPnl: 0,
          currentPrice: fill.price,
        });
        this.adjustCashBookForFill(fill, adjustCash);
      }
      // SELL without existing position (shouldn't happen in spot, but handle gracefully)
      return;
    }

    if (fill.side === "BUY") {
      // Increase position: weighted average entry
      const totalQty = existing.quantity + fill.qty;
      const totalCost =
        existing.avgEntryPrice * existing.quantity + fill.price * fill.qty;
      existing.avgEntryPrice = totalCost / totalQty;
      existing.quantity = totalQty;
      existing.currentPrice = fill.price;
    } else {
      // SELL: realize PnL on sold portion
      const sellQty = Math.min(fill.qty, existing.quantity);
      const grossPnl = (fill.price - existing.avgEntryPrice) * sellQty;
      const netPnl = grossPnl - fill.commission;

      existing.realizedPnl += netPnl;
      existing.quantity -= sellQty;
      existing.currentPrice = fill.price;

      // Record trade (closed round-trip portion)
      const trade: Trade = {
        id: `LT-${++this.tradeIdCounter}`,
        symbol: fill.symbol,
        side: "buy", // entry side for long spot
        entryOrderId: "",
        exitOrderId: fill.orderId || "",
        entryPrice: existing.avgEntryPrice,
        exitPrice: fill.price,
        quantity: sellQty,
        grossPnl,
        commission: fill.commission,
        slippage: 0,
        netPnl,
        entryTime: "", // Not tracked in live mode
        exitTime: new Date(fill.eventTime).toISOString(),
        holdingPeriodBars: 0,
      };
      this.trades.push(trade);

      // Remove position if fully closed
      if (existing.quantity <= 0) {
        this.holdings.delete(fill.symbol);
      }
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

  private updatePeakEquity(): void {
    const currentEquity = this.getTotalEquity();
    this.peakEquity = Math.max(this.peakEquity, currentEquity);
  }

  // ============== GETTERS (mirror SimBroker interface) ==============

  /**
   * Get full portfolio state in the same shape as SimBroker.
   */
  getPortfolioState(): {
    cash: Record<string, number>;
    positions: Position[];
    trades: Trade[];
    totalEquity: number;
    peakEquity: number;
  } {
    const positions = this.getPositions();
    const cashUsdt = this.cashBook.get("USDT") ?? 0;
    const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalEquity = cashUsdt + positionsValue;

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
      side: "long" as const,
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
      side: "long",
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

  getTotalEquity(): number {
    const cashUsdt = this.cashBook.get("USDT") ?? 0;
    const posValue = Array.from(this.holdings.values()).reduce(
      (s, h) => s + h.quantity * h.currentPrice,
      0,
    );
    return cashUsdt + posValue;
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

  getTrackedSymbols(): string[] {
    return Array.from(this.trackedSymbols);
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

  // ============== APPLY FILL (Accounting Loop) ==============

  /**
   * Apply a fill from explicit symbol/quantity/price/commission fields.
   * Positive quantity = BUY, negative = SELL.
   * Updates holdings (qty, avg price, realized PnL) and cash.
   */
  applyFill(fill: {
    symbol: string;
    quantity: number;
    price: number;
    commission?: number;
  }): void {
    const { symbol, quantity, price, commission = 0 } = fill;
    const side: "BUY" | "SELL" = quantity > 0 ? "BUY" : "SELL";
    const absQty = Math.abs(quantity);

    // Convert to LiveFill and delegate to existing logic
    const liveFill: LiveFill = {
      tradeId: `MANUAL-${++this.tradeIdCounter}`,
      symbol,
      side,
      qty: absQty,
      price,
      commission,
      eventTime: Date.now(),
    };

    this.fillIdSet.add(`${symbol}:${liveFill.tradeId}`);
    this.fillLedger.push(liveFill);
    this.applyFillToHoldings(liveFill, true);
    this.trackedSymbols.add(symbol);
    this.updatePeakEquity();

    console.log(
      `[PortfolioManager] Applied fill: ${side} ${absQty} ${symbol} @ ${price} (commission: ${commission})`,
    );
  }
}
