import { BacktestEvent, MarketDataEvent } from './types';

export class EventQueue {
  private events: BacktestEvent[] = [];
  private marketData: Map<string, MarketDataEvent[]> = new Map();
  
  // Add event to queue in chronological order
  enqueue(event: BacktestEvent): void {
    // Find correct position to maintain chronological order
    let insertIndex = this.events.length;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].timestamp <= event.timestamp) {
        insertIndex = i + 1;
        break;
      }
    }
    this.events.splice(insertIndex, 0, event);
  }
  
  // Get next event from queue
  dequeue(): BacktestEvent | null {
    return this.events.shift() || null;
  }
  
  // Check if queue has events
  isEmpty(): boolean {
    return this.events.length === 0;
  }
  
  // Load historical market data
  loadMarketData(symbol: string, data: MarketDataEvent[]): void {
    this.marketData.set(symbol, data);
    
    // Add all market data events to the queue
    data.forEach(event => this.enqueue(event));
  }
  
  // Get market data for a symbol at a specific time
  getMarketDataAt(symbol: string, timestamp: Date): MarketDataEvent | null {
    const symbolData = this.marketData.get(symbol);
    if (!symbolData) return null;
    
    // Find the latest data point before or at the timestamp
    for (let i = symbolData.length - 1; i >= 0; i--) {
      if (symbolData[i].timestamp <= timestamp) {
        return symbolData[i];
      }
    }
    return null;
  }
  
  // Get current market price for a symbol
  getCurrentPrice(symbol: string, timestamp: Date): number | null {
    const marketData = this.getMarketDataAt(symbol, timestamp);
    return marketData ? marketData.close : null;
  }
  
  // Clear all events
  clear(): void {
    this.events = [];
    this.marketData.clear();
  }
  
  // Get queue size
  size(): number {
    return this.events.length;
  }
}