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
import { supabase } from "../config/supabase";

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
 * PortfolioManager - In-memory portfolio engine for live broker mode.
 *
 * Reuses the same weighted-average cost basis and PnL logic as SimBroker
 * to ensure parity between backtest and live results.
 *
 * One instance per (userId, credentialId) pair, managed via static cache.
 */
export class PortfolioManager {
  private static instances = new Map<string, PortfolioManager>();

  private userId: string;
  private broker: string;
  private credentialId: string;

  // In-memory state
  private cashBook = new Map<string, number>(); // asset -> total balance
  private holdings = new Map<string, SpotHolding>(); // symbol -> holding
  private fillLedger: LiveFill[] = [];
  private trades: Trade[] = [];
  private lastSyncedTradeId = new Map<string, number>(); // symbol -> last trade_id
  private tradeIdCounter = 0;

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

  // ============== BOOTSTRAP ==============

  /**
   * Bootstrap portfolio from broker API and persisted fills.
   * 1. Load persisted fills from Supabase
   * 2. Fetch cash balances from Binance /api/v3/account
   * 3. Fetch new fills from /api/v3/myTrades (incremental)
   * 4. Replay all fills to derive avg entry and realized PnL
   */
  async bootstrap(
    baseUrl: string,
    headers: Record<string, string>,
    symbols: string[],
  ): Promise<void> {
    if (this.bootstrapped) return;

    console.log(
      `[PortfolioManager] Bootstrapping for ${this.broker} user=${this.userId}`,
    );

    // 1. Load persisted fills from Supabase
    await this.loadPersistedFills();

    // 2. Fetch cash balances from broker
    await this.fetchCashBalances(baseUrl, headers);

    // 3. Fetch new fills for each tracked symbol
    for (const symbol of symbols) {
      await this.syncSymbolTrades(baseUrl, headers, symbol);
    }

    this.bootstrapped = true;
    console.log(
      `[PortfolioManager] Bootstrap complete: ${this.holdings.size} holdings, ${this.fillLedger.length} fills`,
    );
  }

  /**
   * Load previously persisted fills from Supabase and replay them.
   */
  private async loadPersistedFills(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from("live_fills")
        .select("*")
        .eq("user_id", this.userId)
        .eq("broker", this.broker)
        .eq("credential_id", this.credentialId)
        .order("event_time", { ascending: true });

      if (error) {
        console.error("[PortfolioManager] Failed to load persisted fills:", error);
        return;
      }

      if (data && data.length > 0) {
        for (const row of data) {
          const fill: LiveFill = {
            tradeId: row.trade_id,
            orderId: row.order_id,
            symbol: row.symbol,
            side: row.side as "BUY" | "SELL",
            qty: Number(row.qty),
            price: Number(row.price),
            quoteQty: row.quote_qty ? Number(row.quote_qty) : undefined,
            commission: Number(row.commission),
            commissionAsset: row.commission_asset,
            eventTime: new Date(row.event_time).getTime(),
          };
          this.fillLedger.push(fill);
          this.applyFillToHoldings(fill);

          // Track last synced trade ID per symbol
          const tradeIdNum = parseInt(fill.tradeId, 10);
          const currentMax = this.lastSyncedTradeId.get(fill.symbol) ?? 0;
          if (tradeIdNum > currentMax) {
            this.lastSyncedTradeId.set(fill.symbol, tradeIdNum);
          }
        }
        console.log(
          `[PortfolioManager] Loaded ${data.length} persisted fills`,
        );
      }
    } catch (err) {
      console.error("[PortfolioManager] Error loading persisted fills:", err);
    }
  }

  /**
   * Fetch cash balances from Binance Spot /api/v3/account.
   */
  private async fetchCashBalances(
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<void> {
    try {
      const response = await axios.get(`${baseUrl}/api/v3/account`, {
        headers,
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
   * Incremental sync: fetch new trades from broker for a symbol.
   */
  async syncSymbolTrades(
    baseUrl: string,
    headers: Record<string, string>,
    symbol: string,
  ): Promise<number> {
    try {
      const fromId = this.lastSyncedTradeId.get(symbol);
      const params: Record<string, any> = { symbol };
      if (fromId) {
        params.fromId = fromId + 1; // Binance fromId is inclusive
      }

      const response = await axios.get(`${baseUrl}/api/v3/myTrades`, {
        headers,
        params,
        timeout: 15000,
      });

      const trades = response.data;
      if (!Array.isArray(trades) || trades.length === 0) return 0;

      let newCount = 0;
      for (const t of trades) {
        const tradeId = String(t.id);

        // Dedup against in-memory ledger
        if (this.fillLedger.some((f) => f.symbol === symbol && f.tradeId === tradeId)) {
          continue;
        }

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

        this.fillLedger.push(fill);
        this.applyFillToHoldings(fill);
        newCount++;

        // Async persist (fire-and-forget)
        this.persistFill(fill).catch((err) =>
          console.error("[PortfolioManager] Persist fill error:", err),
        );

        const idNum = parseInt(tradeId, 10);
        const currentMax = this.lastSyncedTradeId.get(symbol) ?? 0;
        if (idNum > currentMax) {
          this.lastSyncedTradeId.set(symbol, idNum);
        }
      }

      if (newCount > 0) {
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

  /**
   * Sync trades for multiple symbols.
   */
  async syncFromBroker(
    baseUrl: string,
    headers: Record<string, string>,
    symbols: string[],
  ): Promise<number> {
    let total = 0;
    for (const symbol of symbols) {
      total += await this.syncSymbolTrades(baseUrl, headers, symbol);
    }
    return total;
  }

  // ============== FILL APPLICATION (mirrors SimBroker logic) ==============

  /**
   * Apply a fill to in-memory holdings.
   * Uses the same weighted-average cost basis logic as SimBroker.applyFill().
   */
  private applyFillToHoldings(fill: LiveFill): void {
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
  }

  // ============== PERSISTENCE ==============

  /**
   * Persist a single fill to Supabase (async, fire-and-forget).
   */
  private async persistFill(fill: LiveFill): Promise<void> {
    await supabase.from("live_fills").upsert(
      {
        user_id: this.userId,
        broker: this.broker,
        credential_id: this.credentialId,
        symbol: fill.symbol,
        trade_id: fill.tradeId,
        order_id: fill.orderId,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        quote_qty: fill.quoteQty,
        commission: fill.commission,
        commission_asset: fill.commissionAsset,
        event_time: new Date(fill.eventTime).toISOString(),
      },
      { onConflict: "user_id,broker,symbol,trade_id" },
    );
  }

  /**
   * Take a periodic snapshot of positions and cash to Supabase.
   */
  async snapshotToDb(): Promise<void> {
    const now = new Date().toISOString();

    // Position snapshots
    const posRows = Array.from(this.holdings.values()).map((h) => ({
      user_id: this.userId,
      broker: this.broker,
      credential_id: this.credentialId,
      symbol: h.symbol,
      quantity: h.quantity,
      avg_entry_price: h.avgEntryPrice,
      current_price: h.currentPrice,
      unrealized_pnl: (h.currentPrice - h.avgEntryPrice) * h.quantity,
      realized_pnl: h.realizedPnl,
      snapshot_at: now,
    }));

    if (posRows.length > 0) {
      await supabase.from("position_snapshots").insert(posRows);
    }

    // Cash snapshot
    const balancesObj: Record<string, number> = {};
    for (const [asset, amount] of this.cashBook) {
      balancesObj[asset] = amount;
    }

    await supabase.from("cash_snapshots").insert({
      user_id: this.userId,
      broker: this.broker,
      credential_id: this.credentialId,
      balances: balancesObj,
      total_value_usdt: this.cashBook.get("USDT") ?? 0,
      snapshot_at: now,
    });
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

    return {
      cash: Object.fromEntries(this.cashBook),
      positions,
      trades: this.trades,
      totalEquity: cashUsdt + positionsValue,
      peakEquity: cashUsdt + positionsValue, // Peak tracking not implemented for live yet
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

  getTrades(): Trade[] {
    return this.trades;
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }
}
