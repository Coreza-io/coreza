/**
 * SimBrokerFast - High-Performance In-Memory Broker
 * All operations synchronous, no Redis/DB during backtest loop
 */

import { v4 as uuidv4 } from 'uuid';
import { Bar, Trade, EquityPoint, FastBacktestConfig } from './strategyIR';

// ============= Position & Order Types =============

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  side: 'long' | 'short';
  entryTime: number;
  entryTradeId: string;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'stop';
  limitPrice?: number;
  stopPrice?: number;
  createdAt: number;
}

// ============= SimBrokerFast Class =============

export class SimBrokerFast {
  // Portfolio state
  private cash: number;
  private initialCash: number;
  private positions: Map<string, Position> = new Map();
  private pendingOrders: PendingOrder[] = [];
  
  // Trade history
  private trades: Trade[] = [];
  private equityCurve: EquityPoint[] = [];
  
  // Configuration
  private config: FastBacktestConfig;
  
  // Peak tracking for drawdown
  private peakEquity: number;
  
  constructor(config: FastBacktestConfig) {
    this.config = config;
    this.cash = config.initialCash;
    this.initialCash = config.initialCash;
    this.peakEquity = config.initialCash;
  }

  // ============= Order Execution =============

  /**
   * Place a market order (fills immediately)
   */
  marketOrder(symbol: string, side: 'buy' | 'sell', quantity: number, bar: Bar): Trade | null {
    const fillPrice = this.applySlippage(bar.c, side);
    return this.executeFill(symbol, side, quantity, fillPrice, bar.t);
  }

  /**
   * Place a limit order (fills when price crosses)
   */
  limitOrder(symbol: string, side: 'buy' | 'sell', quantity: number, limitPrice: number, bar: Bar): string {
    const orderId = uuidv4();
    this.pendingOrders.push({
      id: orderId,
      symbol,
      side,
      quantity,
      orderType: 'limit',
      limitPrice,
      createdAt: bar.t
    });
    return orderId;
  }

  /**
   * Place a stop order (fills when price crosses stop)
   */
  stopOrder(symbol: string, side: 'buy' | 'sell', quantity: number, stopPrice: number, bar: Bar): string {
    const orderId = uuidv4();
    this.pendingOrders.push({
      id: orderId,
      symbol,
      side,
      quantity,
      orderType: 'stop',
      stopPrice,
      createdAt: bar.t
    });
    return orderId;
  }

  /**
   * Process pending orders against current bar
   */
  processPendingOrders(symbol: string, bar: Bar): Trade[] {
    const executedTrades: Trade[] = [];
    const remainingOrders: PendingOrder[] = [];

    for (const order of this.pendingOrders) {
      if (order.symbol !== symbol) {
        remainingOrders.push(order);
        continue;
      }

      let shouldFill = false;
      let fillPrice = bar.c;

      if (order.orderType === 'limit') {
        if (order.side === 'buy' && bar.l <= order.limitPrice!) {
          shouldFill = true;
          fillPrice = Math.min(order.limitPrice!, bar.o);
        } else if (order.side === 'sell' && bar.h >= order.limitPrice!) {
          shouldFill = true;
          fillPrice = Math.max(order.limitPrice!, bar.o);
        }
      } else if (order.orderType === 'stop') {
        if (order.side === 'buy' && bar.h >= order.stopPrice!) {
          shouldFill = true;
          fillPrice = Math.max(order.stopPrice!, bar.o);
        } else if (order.side === 'sell' && bar.l <= order.stopPrice!) {
          shouldFill = true;
          fillPrice = Math.min(order.stopPrice!, bar.o);
        }
      }

      if (shouldFill) {
        const trade = this.executeFill(order.symbol, order.side, order.quantity, fillPrice, bar.t);
        if (trade) {
          executedTrades.push(trade);
        }
      } else {
        remainingOrders.push(order);
      }
    }

    this.pendingOrders = remainingOrders;
    return executedTrades;
  }

  /**
   * Cancel a pending order
   */
  cancelOrder(orderId: string): boolean {
    const index = this.pendingOrders.findIndex(o => o.id === orderId);
    if (index >= 0) {
      this.pendingOrders.splice(index, 1);
      return true;
    }
    return false;
  }

  // ============= Position Management =============

  /**
   * Close all positions for a symbol
   */
  closePosition(symbol: string, bar: Bar): Trade | null {
    const position = this.positions.get(symbol);
    if (!position) return null;

    const side = position.side === 'long' ? 'sell' : 'buy';
    return this.marketOrder(symbol, side, position.quantity, bar);
  }

  /**
   * Close all positions
   */
  closeAllPositions(prices: Map<string, number>, timestamp: number): Trade[] {
    const closedTrades: Trade[] = [];
    
    for (const [symbol, position] of this.positions) {
      const price = prices.get(symbol);
      if (!price) continue;
      
      const side = position.side === 'long' ? 'sell' : 'buy';
      const trade = this.executeFill(symbol, side, position.quantity, price, timestamp);
      if (trade) {
        closedTrades.push(trade);
      }
    }
    
    return closedTrades;
  }

  /**
   * Get current position for symbol
   */
  getPosition(symbol: string): Position | null {
    return this.positions.get(symbol) || null;
  }

  /**
   * Check if we have any position
   */
  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  /**
   * Check if we have a long position
   */
  isLong(symbol: string): boolean {
    const pos = this.positions.get(symbol);
    return pos?.side === 'long' ?? false;
  }

  /**
   * Check if we have a short position
   */
  isShort(symbol: string): boolean {
    const pos = this.positions.get(symbol);
    return pos?.side === 'short' ?? false;
  }

  // ============= Portfolio State =============

  /**
   * Get current cash balance
   */
  getCash(): number {
    return this.cash;
  }

  /**
   * Get total equity at current prices
   */
  getEquity(prices: Map<string, number>): number {
    let positionValue = 0;
    
    for (const [symbol, position] of this.positions) {
      const price = prices.get(symbol) || position.avgPrice;
      const value = position.quantity * price;
      
      if (position.side === 'long') {
        positionValue += value;
      } else {
        // Short: profit when price goes down
        positionValue += (2 * position.avgPrice * position.quantity) - value;
      }
    }
    
    return this.cash + positionValue;
  }

  /**
   * Get position value at current prices
   */
  getPositionValue(prices: Map<string, number>): number {
    let value = 0;
    
    for (const [symbol, position] of this.positions) {
      const price = prices.get(symbol) || position.avgPrice;
      value += position.quantity * price;
    }
    
    return value;
  }

  /**
   * Record equity snapshot
   */
  recordEquity(timestamp: number, prices: Map<string, number>): void {
    const equity = this.getEquity(prices);
    const positionValue = this.getPositionValue(prices);
    
    // Update peak for drawdown calculation
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    
    const drawdown = this.peakEquity > 0 
      ? (this.peakEquity - equity) / this.peakEquity 
      : 0;
    
    // Calculate daily return if we have previous equity
    let dailyReturn: number | undefined;
    if (this.equityCurve.length > 0) {
      const prevEquity = this.equityCurve[this.equityCurve.length - 1].equity;
      dailyReturn = prevEquity > 0 ? (equity - prevEquity) / prevEquity : 0;
    }
    
    this.equityCurve.push({
      timestamp,
      equity,
      cash: this.cash,
      positionValue,
      drawdown,
      dailyReturn
    });
  }

  // ============= Results =============

  /**
   * Get all trades
   */
  getTrades(): Trade[] {
    return this.trades;
  }

  /**
   * Get equity curve
   */
  getEquityCurve(): EquityPoint[] {
    return this.equityCurve;
  }

  /**
   * Get final portfolio state
   */
  getFinalState(prices: Map<string, number>): {
    cash: number;
    equity: number;
    positions: Position[];
    pendingOrders: PendingOrder[];
  } {
    return {
      cash: this.cash,
      equity: this.getEquity(prices),
      positions: Array.from(this.positions.values()),
      pendingOrders: [...this.pendingOrders]
    };
  }

  // ============= Private Methods =============

  private executeFill(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    timestamp: number
  ): Trade | null {
    const commission = this.calculateCommission(quantity, price);
    const slippage = Math.abs(price - price / (1 + this.config.slippageValue / 100));
    const totalCost = quantity * price + commission;
    
    // Check if we can afford the trade
    if (side === 'buy' && totalCost > this.cash) {
      return null;
    }
    
    // Check if short selling is allowed
    if (side === 'sell' && !this.config.allowShort) {
      const position = this.positions.get(symbol);
      if (!position || position.quantity < quantity) {
        // Can only sell what we have
        if (!position) return null;
        quantity = position.quantity;
      }
    }

    const tradeId = uuidv4();
    const existingPosition = this.positions.get(symbol);

    let trade: Trade;

    if (side === 'buy') {
      this.cash -= totalCost;
      
      if (existingPosition) {
        if (existingPosition.side === 'long') {
          // Add to long position
          const totalQty = existingPosition.quantity + quantity;
          const totalValue = (existingPosition.quantity * existingPosition.avgPrice) + (quantity * price);
          existingPosition.quantity = totalQty;
          existingPosition.avgPrice = totalValue / totalQty;
        } else {
          // Close short position
          const pnl = (existingPosition.avgPrice - price) * Math.min(quantity, existingPosition.quantity);
          
          if (quantity >= existingPosition.quantity) {
            // Fully close short
            this.positions.delete(symbol);
            
            if (quantity > existingPosition.quantity) {
              // Open new long with remaining
              this.positions.set(symbol, {
                symbol,
                quantity: quantity - existingPosition.quantity,
                avgPrice: price,
                side: 'long',
                entryTime: timestamp,
                entryTradeId: tradeId
              });
            }
          } else {
            // Partially close short
            existingPosition.quantity -= quantity;
          }
        }
      } else {
        // New long position
        this.positions.set(symbol, {
          symbol,
          quantity,
          avgPrice: price,
          side: 'long',
          entryTime: timestamp,
          entryTradeId: tradeId
        });
      }

      trade = {
        id: tradeId,
        symbol,
        side: 'buy',
        quantity,
        entryPrice: price,
        entryTime: timestamp,
        commission,
        slippage,
        holdingPeriod: 0
      };
    } else {
      // Sell
      if (existingPosition && existingPosition.side === 'long') {
        // Close long position
        const exitQty = Math.min(quantity, existingPosition.quantity);
        const pnl = (price - existingPosition.avgPrice) * exitQty - commission;
        const pnlPercent = ((price - existingPosition.avgPrice) / existingPosition.avgPrice) * 100;
        
        this.cash += exitQty * price - commission;
        
        trade = {
          id: tradeId,
          symbol,
          side: 'sell',
          quantity: exitQty,
          entryPrice: existingPosition.avgPrice,
          entryTime: existingPosition.entryTime,
          exitPrice: price,
          exitTime: timestamp,
          pnl,
          pnlPercent,
          commission,
          slippage,
          holdingPeriod: timestamp - existingPosition.entryTime
        };
        
        if (exitQty >= existingPosition.quantity) {
          this.positions.delete(symbol);
        } else {
          existingPosition.quantity -= exitQty;
        }
      } else if (this.config.allowShort) {
        // Open short position
        this.cash += quantity * price - commission;
        
        if (existingPosition && existingPosition.side === 'short') {
          // Add to short
          const totalQty = existingPosition.quantity + quantity;
          const totalValue = (existingPosition.quantity * existingPosition.avgPrice) + (quantity * price);
          existingPosition.quantity = totalQty;
          existingPosition.avgPrice = totalValue / totalQty;
        } else {
          this.positions.set(symbol, {
            symbol,
            quantity,
            avgPrice: price,
            side: 'short',
            entryTime: timestamp,
            entryTradeId: tradeId
          });
        }
        
        trade = {
          id: tradeId,
          symbol,
          side: 'sell',
          quantity,
          entryPrice: price,
          entryTime: timestamp,
          commission,
          slippage,
          holdingPeriod: 0
        };
      } else {
        return null;
      }
    }

    this.trades.push(trade);
    return trade;
  }

  private applySlippage(price: number, side: 'buy' | 'sell'): number {
    if (this.config.slippageType === 'none' || this.config.slippageValue === 0) {
      return price;
    }
    
    const slippageFactor = side === 'buy' ? 1 : -1;
    
    if (this.config.slippageType === 'fixed') {
      return price + (slippageFactor * this.config.slippageValue);
    } else {
      // Percentage
      return price * (1 + (slippageFactor * this.config.slippageValue / 100));
    }
  }

  private calculateCommission(quantity: number, price: number): number {
    switch (this.config.commissionType) {
      case 'none':
        return 0;
      case 'per_share':
        return quantity * this.config.commissionValue;
      case 'percentage':
        return (quantity * price) * (this.config.commissionValue / 100);
      case 'fixed':
        return this.config.commissionValue;
      default:
        return 0;
    }
  }
}
