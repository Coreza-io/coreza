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

import { v4 as uuidv4 } from 'uuid';
import {
  SimBrokerConfig,
  DEFAULT_SIM_BROKER_CONFIG,
  Bar,
  Order,
  OrderRequest,
  OrderResult,
  OrderFill,
  Position,
  Trade,
  EquityPoint,
  PortfolioState,
  BacktestMetrics,
  IFillModel,
  ISlippageModel,
  IFeeModel,
} from './interfaces';
import { createFillModel } from './FillModel';
import { createSlippageModel } from './SlippageModel';
import { createFeeModel } from './FeeModel';

/**
 * SimBroker - In-Memory Simulated Broker for Backtesting
 * 
 * High-performance in-memory portfolio state management.
 * All operations are SYNCHRONOUS for maximum speed during bar iteration.
 * No Redis round-trips during backtest execution.
 * 
 * Performance: 100-500x faster than Redis-based approach
 * - 10 years daily bars (2,520): ~0.1-0.5 seconds
 * - 1 year 1-minute bars (390,000): ~10-30 seconds
 * 
 * Usage:
 * 1. Initialize with BacktestInit node (creates in-memory state)
 * 2. Call placeOrder() from BacktestTrade node (synchronous)
 * 3. Call onBar() during each loop iteration to process pending orders (synchronous)
 * 4. Call recordSnapshot() with BacktestSnapshot node to record equity (synchronous)
 * 5. Call getMetrics() with BacktestResults node to calculate performance (synchronous)
 */
export class SimBroker {
  private backtestId: string;
  private config: SimBrokerConfig;
  private fillModel: IFillModel;
  private slippageModel: ISlippageModel;
  private feeModel: IFeeModel;
  private previousBar: Bar | null = null;
  
  // IN-MEMORY STATE - no Redis!
  private state: PortfolioState;

  constructor(backtestId: string, config: Partial<SimBrokerConfig> = {}) {
    this.backtestId = backtestId;
    this.config = { ...DEFAULT_SIM_BROKER_CONFIG, ...config };
    this.fillModel = createFillModel(this.config.fillModel);
    this.slippageModel = createSlippageModel(this.config.slippageModel, this.config.slippageValue);
    this.feeModel = createFeeModel(this.config.commissionModel, this.config.commissionValue);
    
    // Initialize state immediately in memory
    this.state = {
      cash: this.config.initialCapital,
      positions: {},
      pendingOrders: [],
      filledOrders: [],
      trades: [],
      equityCurve: [],
      peakEquity: this.config.initialCapital,
    };
  }

  // ============== IN-MEMORY STATE MANAGEMENT ==============

  /**
   * Initialize portfolio - SYNCHRONOUS (no Redis)
   * State is already initialized in constructor, this just logs
   */
  initializePortfolio(): void {
    console.log(`[SimBroker] Initialized in-memory portfolio for backtest ${this.backtestId} with $${this.config.initialCapital}`);
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
   */
  placeOrder(request: OrderRequest): OrderResult {
    // Validate order
    const validation = this.validateOrder(request, this.state);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Create order
    const order: Order = {
      ...request,
      id: `SIM-${uuidv4().slice(0, 8)}`,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      filledQty: 0,
      avgFillPrice: 0,
      commission: 0,
      slippage: 0,
    };

    this.state.pendingOrders.push(order);

    console.log(`[SimBroker] Order placed: ${order.id} ${order.side} ${order.quantity} ${order.symbol} @ ${order.type}`);
    
    return { success: true, orderId: order.id, status: 'pending' };
  }

  private validateOrder(request: OrderRequest, state: PortfolioState): { valid: boolean; error?: string } {
    // Check quantity
    if (request.quantity <= 0) {
      return { valid: false, error: 'Quantity must be positive' };
    }

    // Check limit/stop prices
    if (request.type === 'limit' && !request.limitPrice) {
      return { valid: false, error: 'Limit price required for limit orders' };
    }
    if (request.type === 'stop' && !request.stopPrice) {
      return { valid: false, error: 'Stop price required for stop orders' };
    }
    if (request.type === 'stop_limit' && (!request.stopPrice || !request.limitPrice)) {
      return { valid: false, error: 'Both stop and limit prices required for stop-limit orders' };
    }

    // Estimate required capital for buy orders
    if (request.side === 'buy') {
      const currentPrice = state.currentBar?.close ?? request.limitPrice ?? 100;
      const estimatedCost = request.quantity * currentPrice;
      
      if (estimatedCost > state.cash * 0.99) { // 1% buffer for commissions
        return { valid: false, error: `Insufficient buying power. Required: $${estimatedCost.toFixed(2)}, Available: $${state.cash.toFixed(2)}` };
      }
    }

    // Check for short selling
    if (request.side === 'sell' && !this.config.allowShort) {
      const position = state.positions[request.symbol];
      const currentQty = position?.quantity ?? 0;
      
      if (request.quantity > currentQty) {
        return { valid: false, error: `Cannot sell ${request.quantity} shares. Only ${currentQty} shares held. Short selling disabled.` };
      }
    }

    return { valid: true };
  }

  // ============== BAR PROCESSING ==============

  /**
   * Process bar - SYNCHRONOUS (no Redis)
   */
  onBar(symbol: string, bar: Bar): OrderFill[] {
    const fills: OrderFill[] = [];

    // Store current bar in state
    this.state.currentBar = bar;

    // Process pending orders for this symbol
    const pendingForSymbol = this.state.pendingOrders.filter(o => o.symbol === symbol);
    const remainingPending: Order[] = this.state.pendingOrders.filter(o => o.symbol !== symbol);

    for (const order of pendingForSymbol) {
      const fillResult = this.fillModel.fill(order, bar, this.previousBar ?? undefined);

      if (fillResult.filled && fillResult.price && fillResult.quantity) {
        // Calculate slippage
        const slippage = this.slippageModel.getSlippage(order, fillResult.price, bar);
        const adjustedPrice = fillResult.price + slippage;

        // Calculate commission
        const commission = this.feeModel.getCommission(order, adjustedPrice, fillResult.quantity);

        // Apply fill
        this.applyFill(order, adjustedPrice, fillResult.quantity, slippage, commission, bar.timestamp);

        // Update order status
        order.status = 'filled';
        order.filledQty = fillResult.quantity;
        order.avgFillPrice = adjustedPrice;
        order.commission = commission;
        order.slippage = slippage;
        order.filledAt = bar.timestamp;
        order.barTimestamp = bar.timestamp;

        this.state.filledOrders.push(order);

        fills.push({
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: fillResult.quantity,
          price: adjustedPrice,
          slippage,
          commission,
          timestamp: bar.timestamp,
        });

        console.log(`[SimBroker] Order filled: ${order.id} ${order.side} ${fillResult.quantity} ${symbol} @ $${adjustedPrice.toFixed(2)} (slip: $${slippage.toFixed(4)}, comm: $${commission.toFixed(4)})`);
      } else {
        // Order not filled, keep it pending
        remainingPending.push(order);
      }
    }

    this.state.pendingOrders = remainingPending;

    // Update position mark-to-market
    this.updatePositionMTM(symbol, bar.close);

    // Auto-record equity snapshot on every bar
    const positionsValue = Object.values(this.state.positions).reduce(
      (sum, p) => sum + p.marketValue,
      0,
    );
    const totalEquity = this.state.cash + positionsValue;

    if (totalEquity > this.state.peakEquity) {
      this.state.peakEquity = totalEquity;
    }
    const drawdownPct =
      this.state.peakEquity > 0
        ? ((this.state.peakEquity - totalEquity) / this.state.peakEquity) * 100
        : 0;

    this.state.equityCurve.push({
      timestamp: bar.timestamp,
      cash: this.state.cash,
      positionsValue,
      totalEquity,
      drawdownPct,
    });

    // Remember this bar for next iteration
    this.previousBar = bar;

    return fills;
  }

  /**
   * Attempt to fill a specific pending order at the current bar.
   * Used for immediate fill model only (same-bar execution).
   * Does NOT mutate previousBar or process other pending orders.
   */
  tryFillImmediateOrder(orderId: string, bar: Bar): OrderFill | null {
    if (this.config.fillModel !== 'immediate') {
      return null;
    }

    const orderIdx = this.state.pendingOrders.findIndex((o) => o.id === orderId);
    if (orderIdx === -1) {
      return null;
    }

    const order = this.state.pendingOrders[orderIdx];
    const fillResult = this.fillModel.fill(order, bar);

    if (!fillResult.filled || !fillResult.price || !fillResult.quantity) {
      return null;
    }

    // Keep current bar in state for order validation/price usage
    this.state.currentBar = bar;

    const slippage = this.slippageModel.getSlippage(order, fillResult.price, bar);
    const adjustedPrice = fillResult.price + slippage;
    const commission = this.feeModel.getCommission(order, adjustedPrice, fillResult.quantity);

    this.applyFill(order, adjustedPrice, fillResult.quantity, slippage, commission, bar.timestamp);

    order.status = 'filled';
    order.filledQty = fillResult.quantity;
    order.avgFillPrice = adjustedPrice;
    order.commission = commission;
    order.slippage = slippage;
    order.filledAt = bar.timestamp;
    order.barTimestamp = bar.timestamp;

    this.state.filledOrders.push(order);
    this.state.pendingOrders.splice(orderIdx, 1);

    this.updatePositionMTM(order.symbol, bar.close);

    return {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: fillResult.quantity,
      price: adjustedPrice,
      slippage,
      commission,
      timestamp: bar.timestamp,
    };
  }

  private applyFill(
    order: Order,
    price: number,
    quantity: number,
    slippage: number,
    commission: number,
    timestamp: string
  ): void {
    const totalCost = price * quantity + commission;
    
    if (order.side === 'buy') {
      // Deduct cash
      this.state.cash -= totalCost;

      // Update or create position
      const existing = this.state.positions[order.symbol];
      if (existing) {
        // Average up/down
        const totalQty = existing.quantity + quantity;
        const totalCostBasis = existing.avgEntryPrice * existing.quantity + price * quantity;
        existing.avgEntryPrice = totalCostBasis / totalQty;
        existing.quantity = totalQty;
        existing.side = totalQty >= 0 ? 'long' : 'short';
        existing.currentPrice = price;
        existing.marketValue = totalQty * price;
        existing.unrealizedPnl = (price - existing.avgEntryPrice) * totalQty;
      } else {
        this.state.positions[order.symbol] = {
          symbol: order.symbol,
          side: quantity >= 0 ? 'long' : 'short',
          quantity,
          avgEntryPrice: price,
          currentPrice: price,
          unrealizedPnl: 0,
          realizedPnl: 0,
          marketValue: quantity * price,
        };
      }
    } else {
      // Sell order
      this.state.cash += (price * quantity) - commission;

      const existing = this.state.positions[order.symbol];
      if (existing && existing.quantity > 0) {
        // Calculate realized P&L
        const realizedPnl = (price - existing.avgEntryPrice) * quantity - commission;
        existing.realizedPnl += realizedPnl;
        existing.quantity -= quantity;
        existing.currentPrice = price;
        existing.marketValue = existing.quantity * price;
        existing.unrealizedPnl = (price - existing.avgEntryPrice) * existing.quantity;

        // Record closed trade
        const trade: Trade = {
          id: `TRD-${uuidv4().slice(0, 8)}`,
          symbol: order.symbol,
          side: order.side,
          entryOrderId: 'unknown',
          exitOrderId: order.id,
          entryPrice: existing.avgEntryPrice,
          exitPrice: price,
          quantity,
          grossPnl: (price - existing.avgEntryPrice) * quantity,
          commission,
          slippage: Math.abs(slippage),
          netPnl: realizedPnl,
          entryTime: 'unknown',
          exitTime: timestamp,
          holdingPeriodBars: 0,
        };
        this.state.trades.push(trade);

        // Remove position if fully closed
        if (existing.quantity <= 0) {
          delete this.state.positions[order.symbol];
        }
      }
    }
  }

  updatePositionMTM(symbol: string, currentPrice: number): void {
    const position = this.state.positions[symbol];
    if (position) {
      position.currentPrice = currentPrice;
      position.marketValue = position.quantity * currentPrice;
      position.unrealizedPnl = (currentPrice - position.avgEntryPrice) * position.quantity;
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

  /**
   * Record snapshot - SYNCHRONOUS (no Redis)
   */
  recordSnapshot(timestamp: string, prices: Record<string, number>): EquityPoint {
    // Update all positions with current prices
    for (const [symbol, price] of Object.entries(prices)) {
      this.updatePositionMTM(symbol, price);
    }

    // Calculate total equity
    const positionsValue = Object.values(this.state.positions).reduce((sum, p) => sum + p.marketValue, 0);
    const totalEquity = this.state.cash + positionsValue;

    // Track peak equity and drawdown
    if (totalEquity > this.state.peakEquity) {
      this.state.peakEquity = totalEquity;
    }
    const drawdownPct = this.state.peakEquity > 0 ? ((this.state.peakEquity - totalEquity) / this.state.peakEquity) * 100 : 0;

    const point: EquityPoint = {
      timestamp,
      cash: this.state.cash,
      positionsValue,
      totalEquity,
      drawdownPct,
    };

    this.state.equityCurve.push(point);

    return point;
  }

  // ============== METRICS CALCULATION ==============

  /**
   * Get metrics - SYNCHRONOUS (no Redis)
   */
  getMetrics(): BacktestMetrics {
    const trades = this.state.trades;
    const curve = this.state.equityCurve;
    const initialCapital = this.config.initialCapital;

    // Equity -- always from curve (guaranteed populated by onBar)
    const finalEquity = curve[curve.length - 1]?.totalEquity ?? initialCapital;
    const totalReturn = finalEquity - initialCapital;
    const totalReturnPct = (totalReturn / initialCapital) * 100;

    // Drawdown -- always from curve
    const maxDrawdownPct =
      curve.length > 0 ? Math.max(...curve.map((p) => p.drawdownPct), 0) : 0;
    const maxDrawdown = (maxDrawdownPct / 100) * this.state.peakEquity;

    // Trade statistics (unchanged)
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.netPnl > 0).length;
    const losingTrades = trades.filter((t) => t.netPnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // P&L stats (unchanged)
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

    // Profit factor (unchanged)
    const totalWins = winPnls.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
    const profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Commission & Slippage (unchanged)
    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

    // Risk metrics use daily resampled equity curve (industry standard)
    const dailyCurve = this.resampleToDaily(curve);
    const returns = this.calculateReturns(dailyCurve);
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);

    // Annualized return from daily resampled curve
    const tradingDays = dailyCurve.length;
    const yearsElapsed = tradingDays / 252;
    const annualizedReturn =
      yearsElapsed > 0
        ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100
        : totalReturnPct;

    // Calmar = annualized return / max drawdown (fixed formula)
    const calmarRatio =
      maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : 0;

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
      startDate: curve.length > 0 ? curve[0].timestamp : '',
      endDate: curve.length > 0 ? curve[curve.length - 1].timestamp : '',
      totalBars: curve.length,
    };
  }

  private calculateReturns(curve: EquityPoint[]): number[] {
    if (curve.length < 2) return [];
    
    const returns: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prevEquity = curve[i - 1].totalEquity;
      const currEquity = curve[i].totalEquity;
      if (prevEquity > 0) {
        returns.push((currEquity - prevEquity) / prevEquity);
      }
    }
    return returns;
  }

  private resampleToDaily(curve: EquityPoint[]): EquityPoint[] {
    if (curve.length === 0) return [];

    const dailyMap = new Map<string, EquityPoint>();
    for (const point of curve) {
      // Extract YYYY-MM-DD from ISO timestamp
      const dateKey = point.timestamp.substring(0, 10);
      // Last point seen for the day is treated as end-of-day equity
      dailyMap.set(dateKey, point);
    }

    // Ensure deterministic chronological ordering
    return Array.from(dailyMap.values()).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
  }

  private calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length < 2) return 0;

    const dailyRf = riskFreeRate / 252;
    const excessReturns = returns.map(r => r - dailyRf);
    const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const stdDev = this.standardDeviation(excessReturns);

    if (stdDev === 0) return 0;
    
    // Annualize
    return (avgExcessReturn / stdDev) * Math.sqrt(252);
  }

  private calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length < 2) return 0;

    const dailyRf = riskFreeRate / 252;
    const excessReturns = returns.map(r => r - dailyRf);
    const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    
    // Downside deviation (only negative returns)
    const negativeReturns = excessReturns.filter(r => r < 0);
    if (negativeReturns.length === 0) return avgExcessReturn > 0 ? Infinity : 0;
    
    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length
    );

    if (downsideDeviation === 0) return 0;
    
    // Annualize
    return (avgExcessReturn / downsideDeviation) * Math.sqrt(252);
  }

  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
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
    const positionsValue = Object.values(this.state.positions).reduce((sum, p) => sum + p.marketValue, 0);
    return this.state.cash + positionsValue;
  }

  getPendingOrders(): Order[] {
    return this.state.pendingOrders;
  }

  getTrades(): Trade[] {
    return this.state.trades;
  }

  getEquityCurve(): EquityPoint[] {
    return this.state.equityCurve;
  }

  getConfig(): SimBrokerConfig {
    return this.config;
  }

  getBacktestId(): string {
    return this.backtestId;
  }
}

// Re-export interfaces
export * from './interfaces';
