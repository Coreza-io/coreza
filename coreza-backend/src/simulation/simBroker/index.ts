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

import {
  SimBrokerConfig,
  DEFAULT_SIM_BROKER_CONFIG,
  Bar,
  Order,
  OrderRequest,
  OrderResult,
  OrderEvent,
  OrderTicket,
  Position,
  Trade,
  EquityPoint,
  PortfolioState,
  BacktestMetrics,
  IFillModel,
  ISlippageModel,
  IFeeModel,
  normalizeOrderType,
  isTicketPending,
} from "./interfaces";
import { createFillModel } from "./FillModel";
import { createSlippageModel } from "./SlippageModel";
import { createFeeModel } from "./FeeModel";
import { BarBuffer } from "./BarBuffer";

/**
 * SimBroker - In-Memory Simulated Broker for Backtesting
 *
 * High-performance in-memory portfolio state management.
 * All operations are SYNCHRONOUS for maximum speed during bar iteration.
 * No Redis round-trips during backtest execution.
 *
 * Uses the QC Lean pattern: immutable Order + append-only OrderEvent + OrderTicket aggregate.
 *
 * Performance: 100-500x faster than Redis-based approach
 * - 10 years daily bars (2,520): ~0.1-0.5 seconds
 * - 1 year 1-minute bars (390,000): ~10-30 seconds
 *
 * Usage:
 * 1. Initialize with BacktestInit node (creates in-memory state)
 * 2. Call placeOrder() from BacktestTrade node (synchronous)
 * 3. Call onBar() during each loop iteration to process pending orders (synchronous)
 * 4. Call getMetrics() with BacktestResults node to calculate performance (synchronous)
 */

function asIsoTimestamp(timestamp: string | number): string {
  return typeof timestamp === "number"
    ? new Date(timestamp).toISOString()
    : timestamp;
}

export class SimBroker {
  private backtestId: string;
  private config: SimBrokerConfig;
  private fillModel: IFillModel;
  private slippageModel: ISlippageModel;
  private feeModel: IFeeModel;
  private previousBar: Bar | null = null;
  private orderIdCounter = 0;
  private tradeIdCounter = 0;
  private currentEntryMap = new Map<string, { orderId: string; filledAt: string; barIndex: number }>();
  private equityCurveData: {
    timestamps: Float64Array;
    cash: Float64Array;
    positionsValue: Float64Array;
    totalEquity: Float64Array;
    drawdownPct: Float64Array;
  };
  private equityCurveIndex = 0;
  private positionsValue = 0;

  // IN-MEMORY STATE - no Redis!
  private state: PortfolioState;

  constructor(backtestId: string, config: Partial<SimBrokerConfig> = {}) {
    this.backtestId = backtestId;
    this.config = { ...DEFAULT_SIM_BROKER_CONFIG, ...config };
    this.fillModel = createFillModel(this.config.fillModel);
    this.slippageModel = createSlippageModel(
      this.config.slippageModel,
      this.config.slippageValue,
    );
    this.feeModel = createFeeModel(
      this.config.commissionModel,
      this.config.commissionValue,
    );

    // Initialize state immediately in memory
    this.state = {
      cash: this.config.initialCapital,
      positions: {},
      tickets: {},
      trades: [],
      equityCurve: [], // kept for PortfolioState interface compat; not used in hot path
      peakEquity: this.config.initialCapital,
    };

    const expectedBars = Math.max(1, this.config.expectedBars);
    this.equityCurveData = {
      timestamps: new Float64Array(expectedBars),
      cash: new Float64Array(expectedBars),
      positionsValue: new Float64Array(expectedBars),
      totalEquity: new Float64Array(expectedBars),
      drawdownPct: new Float64Array(expectedBars),
    };
  }

  // ============== IN-MEMORY STATE MANAGEMENT ==============

  /**
   * Initialize portfolio - SYNCHRONOUS (no Redis)
   * State is already initialized in constructor, this just logs
   */
  initializePortfolio(): void {
    console.log(
      `[SimBroker] Initialized in-memory portfolio for backtest ${this.backtestId} with $${this.config.initialCapital}`,
    );
  }

  /**
   * Get portfolio state - SYNCHRONOUS (direct memory access)
   */
  getPortfolioState(): PortfolioState {
    return this.state;
  }

  // ============== ORDER MANAGEMENT ==============

  /**
   * Place order - SYNCHRONOUS
   * Creates an immutable Order and wraps it in an OrderTicket.
   */
  placeOrder(request: OrderRequest): OrderResult {
    // Validate order
    const validation = this.validateOrder(request, this.state);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const orderId = `SIM-${++this.orderIdCounter}`;

    // Create immutable Order
    const order: Order = {
      id: orderId,
      symbol: request.symbol,
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      tag: request.tag,
      properties: request.properties,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    // Create OrderTicket aggregate
    const ticket: OrderTicket = {
      orderId,
      order,
      orderEvents: [],
      quantityFilled: 0,
      averageFillPrice: 0,
      totalFees: 0,
    };

    this.state.tickets[orderId] = ticket;

    return { success: true, orderId, status: 'new' };
  }

  private ensureEquityCapacity(): void {
    if (this.equityCurveIndex < this.equityCurveData.timestamps.length) {
      return;
    }

    const current = this.equityCurveData.timestamps.length;
    const next = Math.max(1, current * 2);
    const grow = (arr: Float64Array) => {
      const n = new Float64Array(next);
      n.set(arr);
      return n;
    };

    this.equityCurveData = {
      timestamps: grow(this.equityCurveData.timestamps),
      cash: grow(this.equityCurveData.cash),
      positionsValue: grow(this.equityCurveData.positionsValue),
      totalEquity: grow(this.equityCurveData.totalEquity),
      drawdownPct: grow(this.equityCurveData.drawdownPct),
    };
  }

  private recordEquityPoint(
    timestamp: string | number,
    cash: number,
    positionsValue: number,
    totalEquity: number,
    drawdownPct: number,
  ): void {
    this.ensureEquityCapacity();
    const idx = this.equityCurveIndex++;
    this.equityCurveData.timestamps[idx] = BarBuffer.toEpochMs(timestamp);
    this.equityCurveData.cash[idx] = cash;
    this.equityCurveData.positionsValue[idx] = positionsValue;
    this.equityCurveData.totalEquity[idx] = totalEquity;
    this.equityCurveData.drawdownPct[idx] = drawdownPct;

    // TypedArrays are the primary store — no object array push
  }

  private validateOrder(
    request: OrderRequest,
    state: PortfolioState,
  ): { valid: boolean; error?: string } {
    // Check quantity
    if (request.quantity <= 0) {
      return { valid: false, error: "Quantity must be positive" };
    }

    // Check limit/stop prices
    if (request.orderType === "limit" && !request.limitPrice) {
      return { valid: false, error: "Limit price required for limit orders" };
    }
    if (request.orderType === "stop_market" && !request.stopPrice) {
      return { valid: false, error: "Stop price required for stop orders" };
    }
    if (
      request.orderType === "stop_limit" &&
      (!request.stopPrice || !request.limitPrice)
    ) {
      return {
        valid: false,
        error: "Both stop and limit prices required for stop-limit orders",
      };
    }

    // Estimate required capital for buy orders
    if (request.side === "buy") {
      const currentPrice = state.currentBar?.close ?? request.limitPrice ?? 100;
      const estimatedCost = request.quantity * currentPrice;

      if (estimatedCost > state.cash * 0.99) {
        // 1% buffer for commissions
        return {
          valid: false,
          error: `Insufficient buying power. Required: $${estimatedCost.toFixed(2)}, Available: $${state.cash.toFixed(2)}`,
        };
      }
    }

    // Check for short selling
    if (request.side === "sell" && !this.config.allowShort) {
      const position = state.positions[request.symbol];
      const currentQty = position?.quantity ?? 0;

      if (request.quantity > currentQty) {
        return {
          valid: false,
          error: `Cannot sell ${request.quantity} shares. Only ${currentQty} shares held. Short selling disabled.`,
        };
      }
    }

    return { valid: true };
  }

  // ============== BAR PROCESSING ==============

  /**
   * Process bar - SYNCHRONOUS (no Redis)
   * Iterates pending OrderTickets for the given symbol, attempts fills,
   * and appends OrderEvents on success.
   */
  onBar(symbol: string, bar: Bar): OrderEvent[] {
    const events: OrderEvent[] = [];

    // Store current bar in state
    this.state.currentBar = bar;

    // Process pending tickets for this symbol
    for (const ticketId of Object.keys(this.state.tickets)) {
      const ticket = this.state.tickets[ticketId];
      if (ticket.order.symbol !== symbol || !isTicketPending(ticket)) {
        continue;
      }

      const order = ticket.order;
      const fillResult = this.fillModel.fill(
        order,
        bar,
        this.previousBar ?? undefined,
      );

      if (fillResult.filled && fillResult.price && fillResult.quantity) {
        // Calculate slippage
        const slippage = this.slippageModel.getSlippage(
          order,
          fillResult.price,
          bar,
        );
        const adjustedPrice = fillResult.price + slippage;

        // Calculate commission
        const commission = this.feeModel.getCommission(
          order,
          adjustedPrice,
          fillResult.quantity,
        );

        // Apply fill to portfolio
        this.applyFill(
          order,
          adjustedPrice,
          fillResult.quantity,
          slippage,
          commission,
          bar.timestamp,
        );

        // Create append-only OrderEvent
        const event: OrderEvent = {
          orderId: order.id,
          symbol: order.symbol,
          utcTime: asIsoTimestamp(bar.timestamp),
          status: 'filled',
          side: order.side,
          fillPrice: adjustedPrice,
          fillQuantity: fillResult.quantity,
          orderFee: { value: commission, currency: 'USD' },
          slippage,
        };

        // Update ticket aggregate
        ticket.orderEvents.push(event);
        ticket.quantityFilled += fillResult.quantity;
        ticket.averageFillPrice = adjustedPrice; // single fill per order in sim
        ticket.totalFees += commission;

        // Update order status (the only mutable field)
        order.status = ticket.quantityFilled >= order.quantity ? 'filled' : 'partially_filled';

        events.push(event);
      }
    }

    // Update position mark-to-market
    this.updatePositionMTM(symbol, bar.close);

    // Auto-record equity snapshot on every bar
    const positionsValue = this.positionsValue;
    const totalEquity = this.state.cash + positionsValue;

    if (totalEquity > this.state.peakEquity) {
      this.state.peakEquity = totalEquity;
    }
    const drawdownPct =
      this.state.peakEquity > 0
        ? ((this.state.peakEquity - totalEquity) / this.state.peakEquity) * 100
        : 0;

    this.recordEquityPoint(
      bar.timestamp,
      this.state.cash,
      positionsValue,
      totalEquity,
      drawdownPct,
    );

    // Remember this bar for next iteration
    this.previousBar = bar;

    return events;
  }

  /**
   * Attempt to fill a specific pending order at the current bar.
   * Used for immediate fill model only (same-bar execution).
   * Does NOT mutate previousBar or process other pending orders.
   */
  tryFillImmediateOrder(orderId: string, bar: Bar): OrderEvent | null {
    if (this.config.fillModel !== "immediate") {
      return null;
    }

    const ticket = this.state.tickets[orderId];
    if (!ticket || !isTicketPending(ticket)) {
      return null;
    }

    const order = ticket.order;
    const fillResult = this.fillModel.fill(order, bar);

    if (!fillResult.filled || !fillResult.price || !fillResult.quantity) {
      return null;
    }

    // Keep current bar in state for order validation/price usage
    this.state.currentBar = bar;

    const slippage = this.slippageModel.getSlippage(
      order,
      fillResult.price,
      bar,
    );
    const adjustedPrice = fillResult.price + slippage;
    const commission = this.feeModel.getCommission(
      order,
      adjustedPrice,
      fillResult.quantity,
    );

    this.applyFill(
      order,
      adjustedPrice,
      fillResult.quantity,
      slippage,
      commission,
      bar.timestamp,
    );

    // Create append-only OrderEvent
    const event: OrderEvent = {
      orderId: order.id,
      symbol: order.symbol,
      utcTime: asIsoTimestamp(bar.timestamp),
      status: 'filled',
      side: order.side,
      fillPrice: adjustedPrice,
      fillQuantity: fillResult.quantity,
      orderFee: { value: commission, currency: 'USD' },
      slippage,
    };

    // Update ticket aggregate
    ticket.orderEvents.push(event);
    ticket.quantityFilled += fillResult.quantity;
    ticket.averageFillPrice = adjustedPrice;
    ticket.totalFees += commission;

    // Update order status
    order.status = ticket.quantityFilled >= order.quantity ? 'filled' : 'partially_filled';

    this.updatePositionMTM(order.symbol, bar.close);

    return event;
  }

  private applyFill(
    order: Order,
    price: number,
    quantity: number,
    slippage: number,
    commission: number,
    timestamp: string | number,
  ): void {
    const signedQuantity = order.side === "buy" ? quantity : -quantity;

    if (order.side === "buy") {
      this.state.cash -= price * quantity + commission;
    } else {
      this.state.cash += price * quantity - commission;
    }

    const existing = this.state.positions[order.symbol];
    if (!existing) {
      const marketValue = signedQuantity * price;
      this.state.positions[order.symbol] = {
        symbol: order.symbol,
        side: signedQuantity >= 0 ? "long" : "short",
        quantity: signedQuantity,
        avgEntryPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: 0,
        marketValue,
      };
      this.positionsValue += marketValue;
      this.currentEntryMap.set(order.symbol, {
        orderId: order.id,
        filledAt: asIsoTimestamp(timestamp),
        barIndex: this.equityCurveIndex,
      });
      return;
    }

    const existingQty = existing.quantity;
    const oldMarketValue = existing.marketValue;
    const sameDirection =
      (existingQty >= 0 && signedQuantity >= 0) ||
      (existingQty <= 0 && signedQuantity <= 0);

    if (sameDirection) {
      const totalQty = existingQty + signedQuantity;
      const totalCostBasis =
        existing.avgEntryPrice * Math.abs(existingQty) +
        price * Math.abs(signedQuantity);
      existing.avgEntryPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.side = totalQty >= 0 ? "long" : "short";
      existing.currentPrice = price;
      existing.marketValue = totalQty * price;
      existing.unrealizedPnl = (price - existing.avgEntryPrice) * totalQty;
      this.positionsValue += existing.marketValue - oldMarketValue;
      return;
    }

    const closingQty = Math.min(
      Math.abs(existingQty),
      Math.abs(signedQuantity),
    );
    const isClosingLong = existingQty > 0;
    const grossPnl = isClosingLong
      ? (price - existing.avgEntryPrice) * closingQty
      : (existing.avgEntryPrice - price) * closingQty;
    const commissionForClose =
      commission * (closingQty / Math.abs(signedQuantity));
    const netPnl = grossPnl - commissionForClose;
    const fillTimeIso = asIsoTimestamp(timestamp);
    const entry = this.currentEntryMap.get(order.symbol);
    const entryOrderId = entry?.orderId ?? order.id;
    const entryTime = entry?.filledAt ?? fillTimeIso;
    const holdingPeriodBars = Math.max(
      0,
      this.equityCurveIndex - (entry?.barIndex ?? this.equityCurveIndex),
    );

    existing.realizedPnl += netPnl;

    const trade: Trade = {
      id: `TRD-${++this.tradeIdCounter}`,
      symbol: order.symbol,
      side: isClosingLong ? "buy" : "sell",
      entryOrderId,
      exitOrderId: order.id,
      entryPrice: existing.avgEntryPrice,
      exitPrice: price,
      quantity: closingQty,
      grossPnl,
      commission: commissionForClose,
      slippage: Math.abs(slippage),
      netPnl,
      entryTime,
      exitTime: fillTimeIso,
      holdingPeriodBars,
    };
    this.state.trades.push(trade);

    const newQty = existingQty + signedQuantity;
    if (newQty === 0) {
      this.positionsValue -= oldMarketValue;
      delete this.state.positions[order.symbol];
      this.currentEntryMap.delete(order.symbol);
      return;
    }

    if ((existingQty > 0 && newQty > 0) || (existingQty < 0 && newQty < 0)) {
      existing.quantity = newQty;
      existing.side = newQty >= 0 ? "long" : "short";
      existing.currentPrice = price;
      existing.marketValue = newQty * price;
      existing.unrealizedPnl = (price - existing.avgEntryPrice) * newQty;
      this.positionsValue += existing.marketValue - oldMarketValue;
      return;
    }

    // Position flipped direction on this fill; reset cost basis at fill price
    existing.quantity = newQty;
    existing.side = newQty >= 0 ? "long" : "short";
    existing.avgEntryPrice = price;
    existing.currentPrice = price;
    existing.marketValue = newQty * price;
    existing.unrealizedPnl = 0;
    this.positionsValue += existing.marketValue - oldMarketValue;
    this.currentEntryMap.set(order.symbol, {
      orderId: order.id,
      filledAt: fillTimeIso,
      barIndex: this.equityCurveIndex,
    });
  }

  updatePositionMTM(symbol: string, currentPrice: number): void {
    const position = this.state.positions[symbol];
    if (position) {
      const oldMarketValue = position.marketValue;
      position.currentPrice = currentPrice;
      position.marketValue = position.quantity * currentPrice;
      position.unrealizedPnl =
        (currentPrice - position.avgEntryPrice) * position.quantity;
      this.positionsValue += position.marketValue - oldMarketValue;
    }
  }

  /**
   * Bulk mark-to-market update for all held positions.
   * Called by engine before strategy code runs each bar (QuantConnect-style).
   */
  updateAllPositionsMTM(prices: Record<string, number>): void {
    for (const [symbol, price] of Object.entries(prices)) {
      this.updatePositionMTM(symbol, price);
    }
  }

  /**
   * Get a single position by symbol, or null if not held.
   */
  getPosition(symbol: string): Position | null {
    return this.state.positions[symbol] || null;
  }

  // ============== SNAPSHOT & EQUITY ==============

  // ============== METRICS CALCULATION ==============

  /**
   * Get metrics - SYNCHRONOUS (no Redis)
   */
  getMetrics(): BacktestMetrics {
    const trades = this.state.trades;
    const initialCapital = this.config.initialCapital;
    const ecIdx = this.equityCurveIndex;
    const ecData = this.equityCurveData;

    // Equity from TypedArrays (no object array)
    const lastIdx = ecIdx - 1;
    const finalEquity = lastIdx >= 0 ? ecData.totalEquity[lastIdx] : initialCapital;
    const totalReturn = finalEquity - initialCapital;
    const totalReturnPct = (totalReturn / initialCapital) * 100;

    // Max drawdown from TypedArray (no .map() needed)
    let maxDrawdownPct = 0;
    for (let i = 0; i < ecIdx; i++) {
      if (ecData.drawdownPct[i] > maxDrawdownPct) {
        maxDrawdownPct = ecData.drawdownPct[i];
      }
    }
    const maxDrawdown = (maxDrawdownPct / 100) * this.state.peakEquity;

    // Trade statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.netPnl > 0).length;
    const losingTrades = trades.filter((t) => t.netPnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // P&L stats
    const winPnls = trades.filter((t) => t.netPnl > 0).map((t) => t.netPnl);
    const lossPnls = trades.filter((t) => t.netPnl < 0).map((t) => t.netPnl);
    const avgWin =
      winPnls.length > 0
        ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length
        : 0;
    const avgLoss =
      lossPnls.length > 0
        ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length
        : 0;
    const largestWin = winPnls.length > 0 ? Math.max(...winPnls) : 0;
    const largestLoss = lossPnls.length > 0 ? Math.min(...lossPnls) : 0;
    const avgTradePnl =
      totalTrades > 0
        ? trades.reduce((sum, t) => sum + t.netPnl, 0) / totalTrades
        : 0;

    // Profit factor
    const totalWins = winPnls.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
    const profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Commission & Slippage
    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

    // Risk metrics — resample directly from TypedArrays (no sort, no object creation)
    const dailyReturns = this.resampleToDailyReturns();
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns);
    const sortinoRatio = this.calculateSortinoRatio(dailyReturns);

    // Annualized return from daily resampled curve
    const dailyPoints = dailyReturns.length + 1; // returns = points - 1
    const yearsElapsed = dailyPoints > 1 ? (dailyPoints - 1) / 252 : 0;
    const annualizedReturn =
      yearsElapsed > 0
        ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100
        : totalReturnPct;

    // Calmar uses decimal return units divided by decimal max drawdown
    const calmarRatio =
      maxDrawdownPct > 0 ? annualizedReturn / 100 / maxDrawdownPct : 0;

    // Timestamps from TypedArrays
    const startDate = ecIdx > 0 ? new Date(ecData.timestamps[0]).toISOString() : "";
    const endDate = ecIdx > 0 ? new Date(ecData.timestamps[lastIdx]).toISOString() : "";

    console.log(`[SimBroker] Completed: ${trades.length} trades, ${ecIdx} bars`);

    return {
      totalReturn,
      totalReturnPct,
      annualizedReturn,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      avgTradePnl,
      totalCommission,
      totalSlippage,
      startDate,
      endDate,
      totalBars: ecIdx,
    };
  }

  /**
   * Resample equity curve to daily returns directly from TypedArrays.
   * No sort, no object creation, no Map — just a single linear scan.
   */
  private resampleToDailyReturns(): number[] {
    if (this.equityCurveIndex < 2) return [];

    const DAY_MS = 86_400_000;
    const returns: number[] = [];
    let prevDayBucket = Math.floor(this.equityCurveData.timestamps[0] / DAY_MS);
    let prevEquity = this.equityCurveData.totalEquity[0];

    for (let i = 1; i < this.equityCurveIndex; i++) {
      const dayBucket = Math.floor(this.equityCurveData.timestamps[i] / DAY_MS);
      if (dayBucket !== prevDayBucket) {
        const equity = this.equityCurveData.totalEquity[i];
        if (prevEquity > 0) {
          returns.push((equity - prevEquity) / prevEquity);
        }
        prevEquity = equity;
        prevDayBucket = dayBucket;
      }
    }
    return returns;
  }

  private calculateSharpeRatio(
    returns: number[],
    riskFreeRate: number = 0.02,
  ): number {
    if (returns.length < 30) return 0;

    const dailyRf = Math.pow(1 + riskFreeRate, 1 / 252) - 1;
    const excessReturns = returns.map((r) => r - dailyRf);
    const avgExcessReturn =
      excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const stdDev = this.standardDeviation(excessReturns);

    if (stdDev === 0) return 0;

    // Annualize
    return (avgExcessReturn / stdDev) * Math.sqrt(252);
  }

  private calculateSortinoRatio(
    returns: number[],
    riskFreeRate: number = 0.02,
  ): number {
    if (returns.length < 30) return 0;

    const dailyRf = Math.pow(1 + riskFreeRate, 1 / 252) - 1;
    const excessReturns = returns.map((r) => r - dailyRf);
    const avgExcessReturn =
      excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

    // Downside deviation (only negative returns)
    const negativeReturns = excessReturns.filter((r) => r < 0);
    if (negativeReturns.length === 0) return avgExcessReturn > 0 ? Infinity : 0;

    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + r * r, 0) /
        negativeReturns.length,
    );

    if (downsideDeviation === 0) return 0;

    // Annualize
    return (avgExcessReturn / downsideDeviation) * Math.sqrt(252);
  }

  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  // ============== GETTERS - ALL SYNCHRONOUS ==============

  getPositions(): Position[] {
    return Object.values(this.state.positions);
  }

  getCash(): number {
    return this.state.cash;
  }

  getTotalEquity(): number {
    return this.state.cash + this.positionsValue;
  }

  /**
   * Get pending orders (derived from tickets with non-terminal status).
   */
  getPendingOrders(): Order[] {
    return Object.values(this.state.tickets)
      .filter(isTicketPending)
      .map(t => t.order);
  }

  /**
   * Get all order tickets.
   */
  getTickets(): Record<string, OrderTicket> {
    return this.state.tickets;
  }

  getTrades(): Trade[] {
    return this.state.trades;
  }

  getEquityCurve(): EquityPoint[] {
    // Reconstruct from TypedArrays on demand (for DB persistence only)
    const result: EquityPoint[] = new Array(this.equityCurveIndex);
    for (let i = 0; i < this.equityCurveIndex; i++) {
      result[i] = {
        timestamp: new Date(this.equityCurveData.timestamps[i]).toISOString(),
        cash: this.equityCurveData.cash[i],
        positionsValue: this.equityCurveData.positionsValue[i],
        totalEquity: this.equityCurveData.totalEquity[i],
        drawdownPct: this.equityCurveData.drawdownPct[i],
      };
    }
    return result;
  }

  getConfig(): SimBrokerConfig {
    return this.config;
  }

  getBacktestId(): string {
    return this.backtestId;
  }
}

// Re-export interfaces
export * from "./interfaces";
