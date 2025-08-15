import { Position, Portfolio, MarketDataEvent, FillEvent } from './types';
import { EventQueue } from './EventQueue';

export class PortfolioManager {
  private portfolio: Portfolio;
  private initialCapital: number;
  private commissionModel: (quantity: number, price: number) => number;
  
  constructor(
    initialCapital: number,
    commissionModel?: (quantity: number, price: number) => number
  ) {
    this.initialCapital = initialCapital;
    this.commissionModel = commissionModel || this.defaultCommissionModel;
    
    this.portfolio = {
      cash: initialCapital,
      total_value: initialCapital,
      positions: new Map(),
      daily_returns: [],
      equity_curve: [{ date: new Date(), value: initialCapital }],
      drawdowns: []
    };
  }
  
  private defaultCommissionModel(quantity: number, price: number): number {
    // Simple commission model: 0.1% of trade value, minimum $1
    return Math.max(1.0, quantity * price * 0.001);
  }
  
  // Process a fill event
  processFill(fill: FillEvent, eventQueue: EventQueue): void {
    const { symbol, direction, quantity, fill_price, commission } = fill;
    
    let position = this.portfolio.positions.get(symbol);
    
    if (!position) {
      // Create new position
      position = {
        symbol,
        quantity: 0,
        avg_cost: 0,
        unrealized_pnl: 0,
        realized_pnl: 0,
        market_value: 0,
        side: 'FLAT'
      };
      this.portfolio.positions.set(symbol, position);
    }
    
    const tradeValue = quantity * fill_price;
    
    if (direction === 'BUY') {
      this.executeBuy(position, quantity, fill_price, commission);
      this.portfolio.cash -= (tradeValue + commission);
    } else {
      this.executeSell(position, quantity, fill_price, commission);
      this.portfolio.cash += (tradeValue - commission);
    }
    
    // Update position market value
    const currentPrice = eventQueue.getCurrentPrice(symbol, fill.timestamp);
    if (currentPrice) {
      position.market_value = position.quantity * currentPrice;
      position.unrealized_pnl = position.market_value - (position.quantity * position.avg_cost);
    }
    
    // Update position side
    if (position.quantity > 0) {
      position.side = 'LONG';
    } else if (position.quantity < 0) {
      position.side = 'SHORT';
    } else {
      position.side = 'FLAT';
    }
  }
  
  private executeBuy(position: Position, quantity: number, price: number, commission: number): void {
    if (position.quantity >= 0) {
      // Adding to long position or opening new long
      const totalCost = (position.quantity * position.avg_cost) + (quantity * price);
      position.quantity += quantity;
      position.avg_cost = totalCost / position.quantity;
    } else {
      // Covering short position
      const coverQuantity = Math.min(quantity, Math.abs(position.quantity));
      const remainingQuantity = quantity - coverQuantity;
      
      // Realize P&L from covering short
      const realizedPnl = coverQuantity * (position.avg_cost - price) - commission;
      position.realized_pnl += realizedPnl;
      
      position.quantity += coverQuantity;
      
      // If there's remaining quantity, start new long position
      if (remainingQuantity > 0) {
        position.quantity += remainingQuantity;
        position.avg_cost = price;
      }
    }
  }
  
  private executeSell(position: Position, quantity: number, price: number, commission: number): void {
    if (position.quantity <= 0) {
      // Adding to short position or opening new short
      const totalCost = (Math.abs(position.quantity) * position.avg_cost) + (quantity * price);
      position.quantity -= quantity;
      position.avg_cost = totalCost / Math.abs(position.quantity);
    } else {
      // Selling long position
      const sellQuantity = Math.min(quantity, position.quantity);
      const remainingQuantity = quantity - sellQuantity;
      
      // Realize P&L from selling long
      const realizedPnl = sellQuantity * (price - position.avg_cost) - commission;
      position.realized_pnl += realizedPnl;
      
      position.quantity -= sellQuantity;
      
      // If there's remaining quantity, start new short position
      if (remainingQuantity > 0) {
        position.quantity -= remainingQuantity;
        position.avg_cost = price;
      }
    }
  }
  
  // Update portfolio with current market data
  updatePortfolioValue(timestamp: Date, eventQueue: EventQueue): void {
    let totalMarketValue = this.portfolio.cash;
    
    // Update all positions with current market prices
    this.portfolio.positions.forEach((position, symbol) => {
      const currentPrice = eventQueue.getCurrentPrice(symbol, timestamp);
      if (currentPrice && position.quantity !== 0) {
        position.market_value = position.quantity * currentPrice;
        position.unrealized_pnl = position.market_value - (position.quantity * position.avg_cost);
        totalMarketValue += position.market_value;
      }
    });
    
    const previousValue = this.portfolio.total_value;
    this.portfolio.total_value = totalMarketValue;
    
    // Calculate daily return
    if (previousValue > 0) {
      const dailyReturn = (this.portfolio.total_value - previousValue) / previousValue;
      this.portfolio.daily_returns.push(dailyReturn);
    }
    
    // Update equity curve
    this.portfolio.equity_curve.push({
      date: new Date(timestamp),
      value: this.portfolio.total_value
    });
    
    // Calculate drawdown
    const peak = Math.max(...this.portfolio.equity_curve.map(point => point.value));
    const drawdown = (peak - this.portfolio.total_value) / peak;
    this.portfolio.drawdowns.push({
      date: new Date(timestamp),
      drawdown
    });
  }
  
  // Get current portfolio state
  getPortfolio(): Portfolio {
    return { ...this.portfolio };
  }
  
  // Get position for a symbol
  getPosition(symbol: string): Position | null {
    return this.portfolio.positions.get(symbol) || null;
  }
  
  // Get available cash
  getAvailableCash(): number {
    return this.portfolio.cash;
  }
  
  // Get total portfolio value
  getTotalValue(): number {
    return this.portfolio.total_value;
  }
  
  // Check if we can afford a trade
  canAffordTrade(symbol: string, quantity: number, price: number): boolean {
    const tradeValue = quantity * price;
    const commission = this.commissionModel(quantity, price);
    return this.portfolio.cash >= (tradeValue + commission);
  }
  
  // Get portfolio summary
  getPortfolioSummary(): any {
    const positions = Array.from(this.portfolio.positions.values())
      .filter(pos => pos.quantity !== 0);
    
    const totalUnrealizedPnl = positions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0);
    const totalRealizedPnl = positions.reduce((sum, pos) => sum + pos.realized_pnl, 0);
    
    return {
      cash: this.portfolio.cash,
      total_value: this.portfolio.total_value,
      total_return: (this.portfolio.total_value - this.initialCapital) / this.initialCapital,
      unrealized_pnl: totalUnrealizedPnl,
      realized_pnl: totalRealizedPnl,
      positions_count: positions.length,
      positions: positions
    };
  }
}