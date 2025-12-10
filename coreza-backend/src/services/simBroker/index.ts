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
import { getRedisCache } from '../../config/redis';
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

const PORTFOLIO_KEY_PREFIX = 'backtest:portfolio:';
const PORTFOLIO_TTL = 86400; // 24 hours

/**
 * SimBroker - Simulated Broker for Backtesting
 * 
 * Maintains portfolio state in Redis, handles order execution,
 * applies slippage and commissions, tracks P&L and equity curve.
 * 
 * Usage:
 * 1. Initialize with BacktestInit node (creates portfolio in Redis)
 * 2. Call placeOrder() from BacktestTrade node
 * 3. Call onBar() during each loop iteration to process pending orders
 * 4. Call recordSnapshot() with BacktestSnapshot node to record equity
 * 5. Call getMetrics() with BacktestResults node to calculate performance
 */
export class SimBroker {
  private backtestId: string;
  private config: SimBrokerConfig;
  private fillModel: IFillModel;
  private slippageModel: ISlippageModel;
  private feeModel: IFeeModel;
  private previousBar: Bar | null = null;

  constructor(backtestId: string, config: Partial<SimBrokerConfig> = {}) {
    this.backtestId = backtestId;
    this.config = { ...DEFAULT_SIM_BROKER_CONFIG, ...config };
    this.fillModel = createFillModel(this.config.fillModel);
    this.slippageModel = createSlippageModel(this.config.slippageModel, this.config.slippageValue);
    this.feeModel = createFeeModel(this.config.commissionModel, this.config.commissionValue);
  }

  // ============== REDIS STATE MANAGEMENT ==============\

  private getRedisKey(): string {
    return `${PORTFOLIO_KEY_PREFIX}${this.backtestId}`;
  }

  async initializePortfolio(): Promise<void> {
    const initialState: PortfolioState = {
      cash: this.config.initialCapital,
      positions: {},
      pendingOrders: [],
      filledOrders: [],
      trades: [],
      equityCurve: [],
      peakEquity: this.config.initialCapital,
    };

    const redis = getRedisCache();
    await redis.set(this.getRedisKey(), JSON.stringify(initialState), 'EX', PORTFOLIO_TTL);
    console.log(`[SimBroker] Initialized portfolio for backtest ${this.backtestId} with $${this.config.initialCapital}`);
  }

  async getPortfolioState(): Promise<PortfolioState> {
    const redis = getRedisCache();
    const data = await redis.get(this.getRedisKey());
    
    if (!data) {
      throw new Error(`Portfolio not found for backtest ${this.backtestId}. Call initializePortfolio() first.`);
    }

    return JSON.parse(data) as PortfolioState;
  }

  private async savePortfolioState(state: PortfolioState): Promise<void> {
    const redis = getRedisCache();
    await redis.set(this.getRedisKey(), JSON.stringify(state), 'EX', PORTFOLIO_TTL);
  }

  async cleanup(): Promise<void> {
    const redis = getRedisCache();
    await redis.del(this.getRedisKey());
    console.log(`[SimBroker] Cleaned up portfolio for backtest ${this.backtestId}`);
  }

  // ============== ORDER MANAGEMENT ==============\

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    const state = await this.getPortfolioState();

    // Validate order
    const validation = this.validateOrder(request, state);
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

    state.pendingOrders.push(order);
    await this.savePortfolioState(state);

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

  // ============== BAR PROCESSING ==============\

  async onBar(symbol: string, bar: Bar): Promise<OrderFill[]> {
    const state = await this.getPortfolioState();
    const fills: OrderFill[] = [];

    // Store current bar in state
    state.currentBar = bar;

    // Process pending orders for this symbol
    const pendingForSymbol = state.pendingOrders.filter(o => o.symbol === symbol);
    const remainingPending: Order[] = state.pendingOrders.filter(o => o.symbol !== symbol);

    for (const order of pendingForSymbol) {
      const fillResult = this.fillModel.fill(order, bar, this.previousBar ?? undefined);

      if (fillResult.filled && fillResult.price && fillResult.quantity) {
        // Calculate slippage
        const slippage = this.slippageModel.getSlippage(order, fillResult.price, bar);
        const adjustedPrice = fillResult.price + slippage;

        // Calculate commission
        const commission = this.feeModel.getCommission(order, adjustedPrice, fillResult.quantity);

        // Apply fill
        this.applyFill(state, order, adjustedPrice, fillResult.quantity, slippage, commission, bar.timestamp);

        // Update order status
        order.status = 'filled';
        order.filledQty = fillResult.quantity;
        order.avgFillPrice = adjustedPrice;
        order.commission = commission;
        order.slippage = slippage;
        order.filledAt = bar.timestamp;
        order.barTimestamp = bar.timestamp;

        state.filledOrders.push(order);

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

    state.pendingOrders = remainingPending;

    // Update position mark-to-market
    this.updatePositionMTM(state, symbol, bar.close);

    // Save state
    await this.savePortfolioState(state);

    // Remember this bar for next iteration
    this.previousBar = bar;

    return fills;
  }

  private applyFill(
    state: PortfolioState,
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
      state.cash -= totalCost;

      // Update or create position
      const existing = state.positions[order.symbol];
      if (existing) {
        // Average up/down
        const totalQty = existing.quantity + quantity;
        const totalCostBasis = existing.avgEntryPrice * existing.quantity + price * quantity;
        existing.avgEntryPrice = totalCostBasis / totalQty;
        existing.quantity = totalQty;
        existing.currentPrice = price;
        existing.marketValue = totalQty * price;
        existing.unrealizedPnl = (price - existing.avgEntryPrice) * totalQty;
      } else {
        state.positions[order.symbol] = {
          symbol: order.symbol,
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
      state.cash += (price * quantity) - commission;

      const existing = state.positions[order.symbol];
      if (existing && existing.quantity > 0) {
        // Calculate realized P&L
        const realizedPnl = (price - existing.avgEntryPrice) * quantity - commission - Math.abs(slippage) * quantity;
        existing.realizedPnl += realizedPnl;
        existing.quantity -= quantity;
        existing.currentPrice = price;
        existing.marketValue = existing.quantity * price;
        existing.unrealizedPnl = (price - existing.avgEntryPrice) * existing.quantity;

        // Record closed trade
        if (existing.quantity === 0 || quantity === existing.quantity) {
          // Full position closed - record trade
          // Note: For partial closes, we should track entry order separately
          const trade: Trade = {
            id: `TRD-${uuidv4().slice(0, 8)}`,
            symbol: order.symbol,
            side: order.side,
            entryOrderId: 'unknown', // Would need to track entry order
            exitOrderId: order.id,
            entryPrice: existing.avgEntryPrice,
            exitPrice: price,
            quantity,
            grossPnl: (price - existing.avgEntryPrice) * quantity,
            commission,
            slippage: Math.abs(slippage) * quantity,
            netPnl: realizedPnl,
            entryTime: 'unknown', // Would need to track
            exitTime: timestamp,
            holdingPeriodBars: 0, // Would need to track
          };
          state.trades.push(trade);
        }

        // Remove position if fully closed
        if (existing.quantity <= 0) {
          delete state.positions[order.symbol];
        }
      }
    }
  }

  private updatePositionMTM(state: PortfolioState, symbol: string, currentPrice: number): void {
    const position = state.positions[symbol];
    if (position) {
      position.currentPrice = currentPrice;
      position.marketValue = position.quantity * currentPrice;
      position.unrealizedPnl = (currentPrice - position.avgEntryPrice) * position.quantity;
    }
  }

  // ============== SNAPSHOT & EQUITY ==============\

  async recordSnapshot(timestamp: string, prices: Record<string, number>): Promise<EquityPoint> {
    const state = await this.getPortfolioState();

    // Update all positions with current prices
    for (const [symbol, price] of Object.entries(prices)) {
      this.updatePositionMTM(state, symbol, price);
    }

    // Calculate total equity
    const positionsValue = Object.values(state.positions).reduce((sum, p) => sum + p.marketValue, 0);
    const totalEquity = state.cash + positionsValue;

    // Track peak equity and drawdown
    if (totalEquity > state.peakEquity) {
      state.peakEquity = totalEquity;
    }
    const drawdownPct = state.peakEquity > 0 ? ((state.peakEquity - totalEquity) / state.peakEquity) * 100 : 0;

    const point: EquityPoint = {
      timestamp,
      cash: state.cash,
      positionsValue,
      totalEquity,
      drawdownPct,
    };

    state.equityCurve.push(point);
    await this.savePortfolioState(state);

    return point;
  }

  // ============== METRICS CALCULATION ==============\

  async getMetrics(): Promise<BacktestMetrics> {
    const state = await this.getPortfolioState();
    const trades = state.trades;
    const curve = state.equityCurve;

    // Basic returns
    const initialCapital = this.config.initialCapital;
    const finalEquity = curve.length > 0 ? curve[curve.length - 1].totalEquity : initialCapital;
    const totalReturn = finalEquity - initialCapital;
    const totalReturnPct = (totalReturn / initialCapital) * 100;

    // Drawdown
    const maxDrawdownPct = Math.max(...curve.map(p => p.drawdownPct), 0);
    const maxDrawdown = (maxDrawdownPct / 100) * state.peakEquity;

    // Trade statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.netPnl > 0).length;
    const losingTrades = trades.filter(t => t.netPnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // P&L stats
    const winPnls = trades.filter(t => t.netPnl > 0).map(t => t.netPnl);
    const lossPnls = trades.filter(t => t.netPnl < 0).map(t => t.netPnl);
    
    const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
    const avgLoss = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;
    const largestWin = winPnls.length > 0 ? Math.max(...winPnls) : 0;
    const largestLoss = lossPnls.length > 0 ? Math.min(...lossPnls) : 0;
    const avgTradePnl = totalTrades > 0 ? trades.reduce((sum, t) => sum + t.netPnl, 0) / totalTrades : 0;

    // Profit factor
    const totalWins = winPnls.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Commission & Slippage
    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

    // Calculate returns for Sharpe/Sortino
    const returns = this.calculateReturns(curve);
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const calmarRatio = maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : 0;

    // Annualized return (assuming daily bars)
    const totalBars = curve.length;
    const yearsElapsed = totalBars / 252; // Trading days per year
    const annualizedReturn = yearsElapsed > 0 
      ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100 
      : totalReturnPct;

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
      totalBars,
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

  // ============== GETTERS ==============\

  async getPositions(): Promise<Position[]> {
    const state = await this.getPortfolioState();
    return Object.values(state.positions);
  }

  async getCash(): Promise<number> {
    const state = await this.getPortfolioState();
    return state.cash;
  }

  async getTotalEquity(): Promise<number> {
    const state = await this.getPortfolioState();
    const positionsValue = Object.values(state.positions).reduce((sum, p) => sum + p.marketValue, 0);
    return state.cash + positionsValue;
  }

  async getPendingOrders(): Promise<Order[]> {
    const state = await this.getPortfolioState();
    return state.pendingOrders;
  }

  async getTrades(): Promise<Trade[]> {
    const state = await this.getPortfolioState();
    return state.trades;
  }

  async getEquityCurve(): Promise<EquityPoint[]> {
    const state = await this.getPortfolioState();
    return state.equityCurve;
  }

  getConfig(): SimBrokerConfig {
    return this.config;
  }
}

// Re-export interfaces
export * from './interfaces';
