import { WorkflowNode, WorkflowEdge } from '../nodes/types';
import { SignalEvent, MarketDataEvent, OrderEvent } from './types';
import { EventQueue } from './EventQueue';
import { PortfolioManager } from './PortfolioManager';

export interface StrategyContext {
  currentDate: Date;
  portfolio: PortfolioManager;
  eventQueue: EventQueue;
  indicators: Map<string, any>;
  state: Map<string, any>;
}

export abstract class BaseStrategy {
  protected nodes: WorkflowNode[];
  protected edges: WorkflowEdge[];
  protected context: StrategyContext;
  
  constructor(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.context = {
      currentDate: new Date(),
      portfolio: new PortfolioManager(10000),
      eventQueue: new EventQueue(),
      indicators: new Map(),
      state: new Map()
    };
  }
  
  // Initialize strategy
  abstract initialize(): void;
  
  // Process market data and generate signals
  abstract onMarketData(event: MarketDataEvent): SignalEvent[];
  
  // Handle other strategy logic
  onSignal?(signal: SignalEvent): void;
  onFill?(fill: any): void;
  onEndOfDay?(date: Date): void;
}

export class WorkflowStrategy extends BaseStrategy {
  private nodeExecutors: Map<string, any> = new Map();
  
  initialize(): void {
    // Initialize any strategy-specific state
    this.loadNodeExecutors();
  }
  
  private loadNodeExecutors(): void {
    // Load executors for different node types
    // This would integrate with your existing node execution system
  }
  
  onMarketData(event: MarketDataEvent): SignalEvent[] {
    const signals: SignalEvent[] = [];
    
    try {
      // Update context with current market data
      this.context.currentDate = event.timestamp;
      this.context.customState.set('currentMarketData', event);
      
      // Execute workflow step-by-step like autoexecute
      const nodeResults = this.executeWorkflowStepByStep(event);
      
      // Extract trading signals from node results
      nodeResults.forEach(result => {
        if (result && this.isSignalResult(result)) {
          const signal = this.convertToSignal(result, event);
          if (signal) signals.push(signal);
        }
      });
      
    } catch (error) {
      console.error('Error executing strategy workflow:', error);
    }
    
    return signals;
  }
  
  private executeWorkflowStepByStep(marketData: MarketDataEvent): any[] {
    const results: any[] = [];
    const executed = new Set<string>();
    
    // Get execution order (topological sort)
    const executionOrder = this.getExecutionOrder();
    
    for (const nodeId of executionOrder) {
      const node = this.nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      try {
        // Prepare input data for the node
        const nodeInput = this.prepareNodeInput(node, marketData, executed);
        
        // Execute the node
        const result = this.executeNode(node, nodeInput);
        
        // Store result and mark as executed
        results.push(result);
        executed.add(nodeId);
        
        // Update context with node output
        this.updateContextWithNodeResult(nodeId, result);
        
      } catch (error) {
        console.error(`Failed to execute node ${nodeId}:`, error);
      }
    }
    
    return results;
  }
  
  private prepareNodeInput(node: WorkflowNode, marketData: MarketDataEvent, executed: Set<string>): any {
    // Get inputs from upstream nodes
    const upstreamEdges = this.edges.filter(e => e.target === node.id);
    const inputs: any = {};
    
    // Add market data
    inputs.marketData = marketData;
    inputs[marketData.symbol] = {
      open: marketData.open,
      high: marketData.high, 
      low: marketData.low,
      close: marketData.close,
      volume: marketData.volume,
      timestamp: marketData.timestamp
    };
    
    // Collect outputs from upstream nodes
    upstreamEdges.forEach(edge => {
      if (executed.has(edge.source)) {
        const upstreamResult = this.context.customState.get(`node_${edge.source}_output`);
        if (upstreamResult) {
          inputs[`upstream_${edge.source}`] = upstreamResult;
        }
      }
    });
    
    return inputs;
  }
  
  private updateContextWithNodeResult(nodeId: string, result: any): void {
    // Store node output for downstream nodes
    this.context.customState.set(`node_${nodeId}_output`, result);
    
    // Update indicators if the result contains indicator values
    if (result && typeof result === 'object') {
      Object.entries(result).forEach(([key, value]) => {
        if (typeof value === 'number' && !isNaN(value)) {
          this.context.indicators.set(`${nodeId}_${key}`, value);
        }
      });
    }
  }
  
  private isSignalResult(result: any): boolean {
    if (!result || typeof result !== 'object') return false;
    
    // Check for common signal patterns
    return (
      result.action || result.signal || result.trade ||
      result.buy || result.sell || 
      (result.hasOwnProperty('true') && result.hasOwnProperty('false')) // If node result
    );
  }
  
  private convertToSignal(result: any, marketData: MarketDataEvent): SignalEvent | null {
    let action: 'BUY' | 'SELL' | null = null;
    
    // Determine action from result
    if (result.action) {
      action = result.action.toUpperCase();
    } else if (result.buy === true) {
      action = 'BUY';
    } else if (result.sell === true) {
      action = 'SELL';
    } else if (result.true === true) {
      action = 'BUY'; // Assume true condition means buy
    } else if (result.false === true) {
      action = 'SELL'; // Assume false condition means sell
    }
    
    if (!action || !['BUY', 'SELL'].includes(action)) {
      return null;
    }
    
    const quantity = result.quantity || result.size || 100; // Default quantity
    
    return {
      type: 'SIGNAL',
      timestamp: marketData.timestamp,
      symbol: marketData.symbol,
      action,
      quantity,
      price: marketData.close,
      metadata: {
        source: 'workflow_strategy',
        rawResult: result
      }
    };
  }
  
  private executeNode(node: WorkflowNode, marketData: MarketDataEvent): any {
    // This would integrate with your existing node execution system
    // For now, return a mock result
    
    switch (node.category) {
      case 'Indicators':
        return this.executeIndicatorNode(node, marketData);
      case 'Control':
        return this.executeControlNode(node, marketData);
      case 'Trading':
        return this.executeTradingNode(node, marketData);
      default:
        return null;
    }
  }
  
  private executeIndicatorNode(node: WorkflowNode, marketData: MarketDataEvent): any {
    // Execute indicator nodes (RSI, MACD, etc.)
    const indicators = new Map();
    
    // Mock indicator calculation
    if (node.type === 'RSI') {
      const rsi = this.calculateRSI(marketData.symbol, marketData.close);
      indicators.set(`${node.type}_${marketData.symbol}`, rsi);
    }
    
    return { indicators };
  }
  
  private executeControlNode(node: WorkflowNode, marketData: MarketDataEvent): any {
    // Execute control flow nodes (If, Switch, etc.)
    if (node.type === 'If') {
      const condition = this.evaluateCondition(node, marketData);
      return { condition };
    }
    
    return null;
  }
  
  private executeTradingNode(node: WorkflowNode, marketData: MarketDataEvent): any {
    // Execute trading nodes that can generate signals
    const signals: SignalEvent[] = [];
    
    if (node.type === 'BuySignal') {
      const signal: SignalEvent = {
        type: 'SIGNAL',
        timestamp: marketData.timestamp,
        symbol: marketData.symbol,
        direction: 'LONG',
        strength: 1.0,
        metadata: { nodeId: node.id, nodeType: node.type }
      };
      signals.push(signal);
    } else if (node.type === 'SellSignal') {
      const signal: SignalEvent = {
        type: 'SIGNAL',
        timestamp: marketData.timestamp,
        symbol: marketData.symbol,
        direction: 'SHORT',
        strength: 1.0,
        metadata: { nodeId: node.id, nodeType: node.type }
      };
      signals.push(signal);
    }
    
    return { signals };
  }
  
  private calculateRSI(symbol: string, price: number): number {
    // Mock RSI calculation
    return 50 + Math.random() * 30 - 15; // Random RSI between 35-65
  }
  
  private evaluateCondition(node: WorkflowNode, marketData: MarketDataEvent): boolean {
    // Mock condition evaluation
    return Math.random() > 0.5;
  }
  
  private getExecutionOrder(): string[] {
    // Implement topological sort of nodes based on edges
    const visited = new Set<string>();
    const order: string[] = [];
    
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      // Visit dependencies first
      const dependencies = this.edges
        .filter(edge => edge.target === nodeId)
        .map(edge => edge.source);
      
      dependencies.forEach(depId => visit(depId));
      order.push(nodeId);
    };
    
    // Start with nodes that have no dependencies
    const startNodes = this.nodes
      .filter(node => !this.edges.some(edge => edge.target === node.id))
      .map(node => node.id);
    
    startNodes.forEach(nodeId => visit(nodeId));
    
    return order;
  }
  
  // Position sizing logic
  calculatePositionSize(
    signal: SignalEvent, 
    portfolioValue: number, 
    price: number,
    riskPerTrade: number = 0.02 // 2% risk per trade
  ): number {
    // Simple position sizing: risk a fixed percentage of portfolio
    const riskAmount = portfolioValue * riskPerTrade;
    const positionValue = riskAmount / 0.02; // Assuming 2% stop loss
    
    return Math.floor(positionValue / price);
  }
  
  // Convert signals to orders
  signalToOrder(signal: SignalEvent, positionSize: number): OrderEvent {
    return {
      type: 'ORDER',
      timestamp: signal.timestamp,
      symbol: signal.symbol,
      order_type: 'MARKET',
      direction: signal.direction === 'LONG' ? 'BUY' : 'SELL',
      quantity: positionSize,
      time_in_force: 'GTC',
      metadata: { 
        signalStrength: signal.strength,
        sourceNode: signal.metadata?.nodeId 
      }
    };
  }
}