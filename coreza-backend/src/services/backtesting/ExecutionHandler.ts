import { OrderEvent, FillEvent, MarketDataEvent } from './types';
import { EventQueue } from './EventQueue';

export interface SlippageModel {
  calculateSlippage(
    symbol: string, 
    quantity: number, 
    direction: 'BUY' | 'SELL', 
    marketData: MarketDataEvent
  ): number;
}

export class SimpleSlippageModel implements SlippageModel {
  private slippageRate: number;
  
  constructor(slippageRate: number = 0.001) {
    this.slippageRate = slippageRate;
  }
  
  calculateSlippage(
    symbol: string, 
    quantity: number, 
    direction: 'BUY' | 'SELL', 
    marketData: MarketDataEvent
  ): number {
    // Simple slippage model: fixed percentage of price
    const basePrice = marketData.close;
    const slippage = basePrice * this.slippageRate;
    
    // Slippage works against the trader
    return direction === 'BUY' ? slippage : -slippage;
  }
}

export class VolumeBasedSlippageModel implements SlippageModel {
  private baseSlippageRate: number;
  
  constructor(baseSlippageRate: number = 0.001) {
    this.baseSlippageRate = baseSlippageRate;
  }
  
  calculateSlippage(
    symbol: string, 
    quantity: number, 
    direction: 'BUY' | 'SELL', 
    marketData: MarketDataEvent
  ): number {
    const basePrice = marketData.close;
    const volume = marketData.volume;
    
    // Calculate volume impact - larger trades have more slippage
    const volumeImpact = Math.min(quantity / volume, 0.1); // Cap at 10% of volume
    const slippageRate = this.baseSlippageRate * (1 + volumeImpact * 10);
    
    const slippage = basePrice * slippageRate;
    return direction === 'BUY' ? slippage : -slippage;
  }
}

export class ExecutionHandler {
  private commissionModel: (quantity: number, price: number) => number;
  private slippageModel: SlippageModel;
  private fillLatency: number; // Bars delay for fill
  
  constructor(
    commissionModel?: (quantity: number, price: number) => number,
    slippageModel?: SlippageModel,
    fillLatency: number = 0
  ) {
    this.commissionModel = commissionModel || this.defaultCommissionModel;
    this.slippageModel = slippageModel || new SimpleSlippageModel();
    this.fillLatency = fillLatency;
  }
  
  private defaultCommissionModel(quantity: number, price: number): number {
    // Interactive Brokers-style commission
    return Math.max(1.0, quantity * 0.005); // $0.005 per share, $1 minimum
  }
  
  // Execute an order and generate fill event
  executeOrder(order: OrderEvent, eventQueue: EventQueue): FillEvent | null {
    const marketData = eventQueue.getMarketDataAt(order.symbol, order.timestamp);
    if (!marketData) {
      console.error(`No market data available for ${order.symbol} at ${order.timestamp}`);
      return null;
    }
    
    let fillPrice = this.calculateFillPrice(order, marketData);
    
    // Apply slippage
    const slippage = this.slippageModel.calculateSlippage(
      order.symbol, 
      order.quantity, 
      order.direction, 
      marketData
    );
    fillPrice += slippage;
    
    // Calculate commission
    const commission = this.commissionModel(order.quantity, fillPrice);
    
    // Create fill event
    const fill: FillEvent = {
      type: 'FILL',
      timestamp: new Date(order.timestamp.getTime() + this.fillLatency * 60000), // Add latency
      symbol: order.symbol,
      direction: order.direction,
      quantity: order.quantity,
      fill_price: fillPrice,
      commission: commission,
      slippage: Math.abs(slippage),
      order_id: `${order.symbol}_${order.timestamp.getTime()}`
    };
    
    return fill;
  }
  
  private calculateFillPrice(order: OrderEvent, marketData: MarketDataEvent): number {
    switch (order.order_type) {
      case 'MARKET':
        // Market orders fill at next bar's open (assuming end-of-bar signals)
        return marketData.close; // Simplified: use close price
        
      case 'LIMIT':
        if (!order.price) throw new Error('Limit orders require a price');
        
        // Check if limit order can be filled
        if (order.direction === 'BUY' && marketData.low <= order.price) {
          return Math.min(order.price, marketData.open);
        }
        if (order.direction === 'SELL' && marketData.high >= order.price) {
          return Math.max(order.price, marketData.open);
        }
        return order.price; // Partial fill logic would go here
        
      case 'STOP':
        if (!order.stop_price) throw new Error('Stop orders require a stop price');
        
        // Check if stop is triggered
        if (order.direction === 'BUY' && marketData.high >= order.stop_price) {
          return Math.max(order.stop_price, marketData.open);
        }
        if (order.direction === 'SELL' && marketData.low <= order.stop_price) {
          return Math.min(order.stop_price, marketData.open);
        }
        return marketData.close; // Stop not triggered
        
      case 'STOP_LIMIT':
        // Complex order type - simplified implementation
        return marketData.close;
        
      default:
        return marketData.close;
    }
  }
  
  // Check if an order can be executed given current market conditions
  canExecuteOrder(order: OrderEvent, eventQueue: EventQueue): boolean {
    const marketData = eventQueue.getMarketDataAt(order.symbol, order.timestamp);
    if (!marketData) return false;
    
    switch (order.order_type) {
      case 'MARKET':
        return true;
        
      case 'LIMIT':
        if (!order.price) return false;
        if (order.direction === 'BUY') {
          return marketData.low <= order.price;
        } else {
          return marketData.high >= order.price;
        }
        
      case 'STOP':
        if (!order.stop_price) return false;
        if (order.direction === 'BUY') {
          return marketData.high >= order.stop_price;
        } else {
          return marketData.low <= order.stop_price;
        }
        
      default:
        return true;
    }
  }
  
  // Calculate estimated fill price for an order (for position sizing)
  estimateFillPrice(order: OrderEvent, eventQueue: EventQueue): number | null {
    const marketData = eventQueue.getMarketDataAt(order.symbol, order.timestamp);
    if (!marketData) return null;
    
    let estimatedPrice = this.calculateFillPrice(order, marketData);
    
    // Add estimated slippage
    const slippage = this.slippageModel.calculateSlippage(
      order.symbol, 
      order.quantity, 
      order.direction, 
      marketData
    );
    
    return estimatedPrice + slippage;
  }
}