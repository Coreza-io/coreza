/**
 * Strategy Compiler
 * Compiles visual workflow nodes into Strategy IR for fast backtest execution
 */

import { v4 as uuidv4 } from 'uuid';
import {
  StrategyIR,
  IndicatorDef,
  Rule,
  Condition,
  ConditionGroup,
  ValueRef,
  ActionType,
  QuantityExpression,
  CompilationResult,
  IndicatorType,
  PriceField,
  Comparator,
  RiskConfig,
  UniverseConfig
} from './strategyIR';

// ============= Supported Node Types =============

const COMPILABLE_NODE_TYPES = new Set([
  // Indicators
  'vectorizedindicators', 'rsi', 'ema', 'sma', 'macd', 'bb', 'stoch', 'vwap', 'adx', 'obv', 'atr',
  // Logic
  'if', 'switch',
  // Backtest
  'backtestinit', 'backtesttrade', 'backtestsnapshot', 'backtestresults', 'backtestportfolio',
  // Data
  'yahoofinance', 'alpaca', 'binance',
  // Control
  'loop',
  // Utility
  'transform', 'math', 'field'
]);

const NON_COMPILABLE_NODE_TYPES = new Set([
  'httprequest', 'openai', 'openaimodel', 'aiagent',
  'gmail', 'telegram', 'whatsapp',
  'webhooktrigger', 'redistrigger', 'scheduler',
  'alpacatrade', 'binancetrade', 'dhantrade', 'schwabtrade' // Live trading nodes
]);

// ============= Main Compiler Class =============

export class StrategyCompiler {
  private nodes: any[];
  private edges: any[];
  private nodeMap: Map<string, any>;
  private errors: string[] = [];
  private warnings: string[] = [];
  private unsupportedNodes: string[] = [];

  constructor(nodes: any[], edges: any[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.nodeMap = new Map(nodes.map(n => [n.id, n]));
  }

  /**
   * Check if workflow can be compiled to fast IR
   */
  isCompilable(): boolean {
    // Find nodes that would be inside the backtest loop
    const loopBodyNodes = this.findLoopBodyNodes();
    
    for (const node of loopBodyNodes) {
      const nodeType = this.getNodeType(node);
      
      if (NON_COMPILABLE_NODE_TYPES.has(nodeType)) {
        this.unsupportedNodes.push(`${node.data?.label || nodeType} (${nodeType})`);
        return false;
      }
      
      if (!COMPILABLE_NODE_TYPES.has(nodeType)) {
        // Unknown node type - be conservative
        this.warnings.push(`Unknown node type: ${nodeType}`);
      }
    }
    
    // Must have at least one indicator and one trade node
    const hasIndicator = this.nodes.some(n => this.isIndicatorNode(n));
    const hasTradeNode = this.nodes.some(n => this.getNodeType(n) === 'backtesttrade');
    
    if (!hasIndicator) {
      this.errors.push('No indicator nodes found');
      return false;
    }
    
    if (!hasTradeNode) {
      this.errors.push('No BacktestTrade node found');
      return false;
    }
    
    return true;
  }

  /**
   * Compile workflow to Strategy IR
   */
  compile(): CompilationResult {
    if (!this.isCompilable()) {
      return {
        success: false,
        errors: this.errors,
        warnings: this.warnings,
        unsupportedNodes: this.unsupportedNodes
      };
    }

    try {
      const indicators = this.extractIndicators();
      const { entryRules, exitRules } = this.extractRules();
      const riskConfig = this.extractRiskConfig();
      const universe = this.extractUniverse();

      const ir: StrategyIR = {
        id: uuidv4(),
        name: this.extractStrategyName(),
        version: '1.0.0',
        indicators,
        entryRules,
        exitRules,
        riskConfig,
        universe,
        compiledAt: new Date().toISOString(),
        sourceWorkflowId: this.nodes[0]?.data?.workflowId
      };

      return {
        success: true,
        ir,
        warnings: this.warnings
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Compilation error: ${error instanceof Error ? error.message : String(error)}`],
        warnings: this.warnings
      };
    }
  }

  // ============= Indicator Extraction =============

  private extractIndicators(): IndicatorDef[] {
    const indicators: IndicatorDef[] = [];

    for (const node of this.nodes) {
      const nodeType = this.getNodeType(node);
      const values = node.data?.values || {};

      if (nodeType === 'vectorizedindicators') {
        // Extract all selected indicators from VectorizedIndicators node
        const selected = values.indicators || [];
        
        if (selected.includes('rsi')) {
          indicators.push({
            id: 'rsi',
            type: 'RSI',
            input: 'close',
            params: { period: parseInt(values.rsi_period) || 14 }
          });
        }
        
        if (selected.includes('ema')) {
          indicators.push({
            id: 'ema',
            type: 'EMA',
            input: 'close',
            params: { period: parseInt(values.ema_period) || 20 }
          });
        }
        
        if (selected.includes('sma')) {
          indicators.push({
            id: 'sma',
            type: 'SMA',
            input: 'close',
            params: { period: parseInt(values.sma_period) || 20 }
          });
        }
        
        if (selected.includes('macd')) {
          indicators.push({
            id: 'macd',
            type: 'MACD',
            input: 'close',
            params: {
              fastPeriod: parseInt(values.macd_fast) || 12,
              slowPeriod: parseInt(values.macd_slow) || 26,
              signalPeriod: parseInt(values.macd_signal) || 9
            }
          });
        }
        
        if (selected.includes('bb')) {
          indicators.push({
            id: 'bb',
            type: 'BB',
            input: 'close',
            params: {
              period: parseInt(values.bb_period) || 20,
              stdDev: parseFloat(values.bb_std) || 2
            }
          });
        }
        
        if (selected.includes('stoch')) {
          indicators.push({
            id: 'stoch',
            type: 'STOCH',
            input: 'close',
            params: {
              kPeriod: parseInt(values.stoch_k) || 14,
              dPeriod: parseInt(values.stoch_d) || 3
            }
          });
        }
        
        if (selected.includes('vwap')) {
          indicators.push({
            id: 'vwap',
            type: 'VWAP',
            input: 'close',
            params: {}
          });
        }
        
        if (selected.includes('adx')) {
          indicators.push({
            id: 'adx',
            type: 'ADX',
            input: 'close',
            params: { period: parseInt(values.adx_period) || 14 }
          });
        }
        
        if (selected.includes('obv')) {
          indicators.push({
            id: 'obv',
            type: 'OBV',
            input: 'close',
            params: {}
          });
        }
      } else if (this.isIndicatorNode(node)) {
        // Individual indicator nodes
        const indicatorDef = this.extractSingleIndicator(node, nodeType, values);
        if (indicatorDef) {
          indicators.push(indicatorDef);
        }
      }
    }

    return indicators;
  }

  private extractSingleIndicator(node: any, nodeType: string, values: any): IndicatorDef | null {
    const id = node.data?.label || nodeType;
    
    switch (nodeType) {
      case 'rsi':
        return {
          id,
          type: 'RSI',
          input: 'close',
          params: { period: parseInt(values.period) || 14 }
        };
      case 'ema':
        return {
          id,
          type: 'EMA',
          input: 'close',
          params: { period: parseInt(values.period) || 20 }
        };
      case 'sma':
        return {
          id,
          type: 'SMA',
          input: 'close',
          params: { period: parseInt(values.period) || 20 }
        };
      case 'macd':
        return {
          id,
          type: 'MACD',
          input: 'close',
          params: {
            fastPeriod: parseInt(values.fast_period) || 12,
            slowPeriod: parseInt(values.slow_period) || 26,
            signalPeriod: parseInt(values.signal_period) || 9
          }
        };
      case 'bb':
        return {
          id,
          type: 'BB',
          input: 'close',
          params: {
            period: parseInt(values.period) || 20,
            stdDev: parseFloat(values.std_dev) || 2
          }
        };
      case 'stoch':
        return {
          id,
          type: 'STOCH',
          input: 'close',
          params: {
            kPeriod: parseInt(values.k_period) || 14,
            dPeriod: parseInt(values.d_period) || 3
          }
        };
      case 'adx':
        return {
          id,
          type: 'ADX',
          input: 'close',
          params: { period: parseInt(values.period) || 14 }
        };
      default:
        return null;
    }
  }

  // ============= Rule Extraction =============

  private extractRules(): { entryRules: Rule[]; exitRules: Rule[] } {
    const entryRules: Rule[] = [];
    const exitRules: Rule[] = [];

    // Find If nodes and their connected trade nodes
    const ifNodes = this.nodes.filter(n => this.getNodeType(n) === 'if');
    
    for (const ifNode of ifNodes) {
      const conditions = this.extractConditionsFromIfNode(ifNode);
      
      // Find trade nodes connected to true/false outputs
      const trueTargets = this.findConnectedNodes(ifNode.id, 'true');
      const falseTargets = this.findConnectedNodes(ifNode.id, 'false');
      
      for (const target of trueTargets) {
        if (this.getNodeType(target) === 'backtesttrade') {
          const rule = this.createRuleFromTradeNode(target, conditions, entryRules.length);
          if (rule.action === 'BUY') {
            entryRules.push(rule);
          } else {
            exitRules.push(rule);
          }
        }
      }
      
      for (const target of falseTargets) {
        if (this.getNodeType(target) === 'backtesttrade') {
          // Negate conditions for false branch
          const negatedConditions = this.negateConditions(conditions);
          const rule = this.createRuleFromTradeNode(target, negatedConditions, exitRules.length);
          if (rule.action === 'BUY') {
            entryRules.push(rule);
          } else {
            exitRules.push(rule);
          }
        }
      }
    }

    // Also find standalone BacktestTrade nodes (always execute)
    const standaloneTradeNodes = this.nodes.filter(n => {
      if (this.getNodeType(n) !== 'backtesttrade') return false;
      // Check if not connected to any If node
      const incomingEdges = this.edges.filter(e => e.target === n.id);
      return !incomingEdges.some(e => this.getNodeType(this.nodeMap.get(e.source)) === 'if');
    });

    for (const tradeNode of standaloneTradeNodes) {
      const rule = this.createRuleFromTradeNode(tradeNode, null, entryRules.length + exitRules.length);
      if (rule.action === 'BUY') {
        entryRules.push(rule);
      } else {
        exitRules.push(rule);
      }
    }

    return { entryRules, exitRules };
  }

  private extractConditionsFromIfNode(ifNode: any): Condition | ConditionGroup {
    const values = ifNode.data?.values || {};
    const conditionsArray = values.conditions || [];
    
    if (conditionsArray.length === 0) {
      // Default condition: always true
      return {
        left: { type: 'number', ref: '1' },
        op: '==',
        right: { type: 'number', ref: '1' }
      };
    }
    
    if (conditionsArray.length === 1) {
      return this.parseCondition(conditionsArray[0]);
    }
    
    // Multiple conditions - AND them together
    return {
      logic: 'AND',
      conditions: conditionsArray.map((c: any) => this.parseCondition(c))
    };
  }

  private parseCondition(conditionObj: any): Condition {
    const left = this.parseValueRef(conditionObj.left || '');
    const right = this.parseValueRef(conditionObj.right || '');
    const op = this.mapOperator(conditionObj.operator || 'equals');
    
    return { left, op, right };
  }

  private parseValueRef(value: string): ValueRef {
    if (!value) {
      return { type: 'number', ref: '0' };
    }
    
    // Check if it's a number
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { type: 'number', ref: value };
    }
    
    // Check if it's an indicator reference (e.g., "rsi", "macd.signal", "bb.upper")
    const indicatorMatch = value.match(/^(\w+)(?:\.(\w+))?$/);
    if (indicatorMatch) {
      const [, indicator, field] = indicatorMatch;
      const indicatorTypes = ['rsi', 'ema', 'sma', 'macd', 'bb', 'stoch', 'vwap', 'adx', 'obv'];
      
      if (indicatorTypes.includes(indicator.toLowerCase())) {
        return { type: 'indicator', ref: indicator.toLowerCase(), field };
      }
    }
    
    // Check if it's a price reference
    const priceFields = ['open', 'high', 'low', 'close', 'volume'];
    if (priceFields.includes(value.toLowerCase())) {
      return { type: 'price', ref: value.toLowerCase() };
    }
    
    // Check for position reference
    if (value.toLowerCase().includes('position')) {
      return { type: 'position', ref: value };
    }
    
    // Default to number
    return { type: 'number', ref: value };
  }

  private mapOperator(operator: string): Comparator {
    const mapping: Record<string, Comparator> = {
      'equals': '==',
      'not_equals': '!=',
      'greater_than': '>',
      'less_than': '<',
      'greater_than_or_equals': '>=',
      'less_than_or_equals': '<=',
      'crosses_above': 'crosses_above',
      'crosses_below': 'crosses_below',
      '>': '>',
      '<': '<',
      '>=': '>=',
      '<=': '<=',
      '==': '==',
      '!=': '!='
    };
    return mapping[operator] || '==';
  }

  private createRuleFromTradeNode(tradeNode: any, conditions: Condition | ConditionGroup | null, priority: number): Rule {
    const values = tradeNode.data?.values || {};
    const side = (values.side || 'buy').toLowerCase();
    
    let action: ActionType = 'NOOP';
    if (side === 'buy') {
      action = 'BUY';
    } else if (side === 'sell') {
      action = 'SELL';
    }
    
    const quantity: QuantityExpression = {
      type: 'fixed',
      value: parseFloat(values.quantity) || 1
    };
    
    return {
      id: tradeNode.id,
      priority,
      conditions: conditions || {
        left: { type: 'number', ref: '1' },
        op: '==',
        right: { type: 'number', ref: '1' }
      },
      action,
      quantity
    };
  }

  private negateConditions(conditions: Condition | ConditionGroup): Condition | ConditionGroup {
    if ('logic' in conditions) {
      // Negate condition group using De Morgan's law
      return {
        logic: conditions.logic === 'AND' ? 'OR' : 'AND',
        conditions: conditions.conditions.map(c => this.negateConditions(c as Condition | ConditionGroup))
      };
    }
    
    // Negate single condition
    const negatedOp: Record<Comparator, Comparator> = {
      '>': '<=',
      '<': '>=',
      '>=': '<',
      '<=': '>',
      '==': '!=',
      '!=': '==',
      'crosses_above': 'crosses_below',
      'crosses_below': 'crosses_above'
    };
    
    return {
      ...conditions,
      op: negatedOp[conditions.op] || conditions.op
    };
  }

  // ============= Config Extraction =============

  private extractRiskConfig(): RiskConfig {
    // Find RiskEngine node if exists
    const riskNode = this.nodes.find(n => this.getNodeType(n) === 'riskengine');
    
    if (riskNode) {
      const values = riskNode.data?.values || {};
      return {
        maxPositions: parseInt(values.max_positions) || undefined,
        maxRiskPerTrade: parseFloat(values.max_risk) || undefined,
        stopLossPercent: parseFloat(values.stop_loss) || undefined,
        takeProfitPercent: parseFloat(values.take_profit) || undefined
      };
    }
    
    return {};
  }

  private extractUniverse(): UniverseConfig {
    // Find BacktestInit or data source node for symbols
    const initNode = this.nodes.find(n => this.getNodeType(n) === 'backtestinit');
    const dataNode = this.nodes.find(n => ['yahoofinance', 'alpaca', 'binance'].includes(this.getNodeType(n)));
    
    let symbols: string[] = ['AAPL']; // Default
    let timeframe: UniverseConfig['timeframe'] = '1d';
    
    if (initNode) {
      const values = initNode.data?.values || {};
      // Symbols might be comma-separated or array
      const symbolsValue = values.symbols || values.symbol || 'AAPL';
      symbols = Array.isArray(symbolsValue) 
        ? symbolsValue 
        : symbolsValue.split(',').map((s: string) => s.trim());
    }
    
    if (dataNode) {
      const values = dataNode.data?.values || {};
      const tf = values.timeframe || values.interval || '1d';
      if (['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].includes(tf)) {
        timeframe = tf;
      }
    }
    
    return { symbols, timeframe };
  }

  private extractStrategyName(): string {
    const initNode = this.nodes.find(n => this.getNodeType(n) === 'backtestinit');
    if (initNode?.data?.values?.name) {
      return initNode.data.values.name;
    }
    return 'Compiled Strategy';
  }

  // ============= Helper Methods =============

  private getNodeType(node: any): string {
    return (node?.type || node?.data?.type || '').toLowerCase();
  }

  private isIndicatorNode(node: any): boolean {
    const indicatorTypes = ['rsi', 'ema', 'sma', 'macd', 'bb', 'stoch', 'vwap', 'adx', 'obv', 'atr', 'vectorizedindicators'];
    return indicatorTypes.includes(this.getNodeType(node));
  }

  private findLoopBodyNodes(): any[] {
    // Find Loop node
    const loopNode = this.nodes.find(n => this.getNodeType(n) === 'loop');
    
    if (!loopNode) {
      // No loop = all nodes are "in loop" for compilation purposes
      return this.nodes;
    }
    
    // Find nodes connected to loop's "loop" output
    const loopBodyNodeIds = new Set<string>();
    const queue: string[] = [];
    
    // Find edges from loop's "loop" handle
    const loopEdges = this.edges.filter(e => 
      e.source === loopNode.id && e.sourceHandle === 'loop'
    );
    
    for (const edge of loopEdges) {
      queue.push(edge.target);
    }
    
    // BFS to find all downstream nodes
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (loopBodyNodeIds.has(nodeId)) continue;
      
      loopBodyNodeIds.add(nodeId);
      
      // Find outgoing edges (except back to loop)
      const outEdges = this.edges.filter(e => e.source === nodeId && e.target !== loopNode.id);
      for (const edge of outEdges) {
        queue.push(edge.target);
      }
    }
    
    return this.nodes.filter(n => loopBodyNodeIds.has(n.id));
  }

  private findConnectedNodes(nodeId: string, sourceHandle?: string): any[] {
    const edges = this.edges.filter(e => 
      e.source === nodeId && 
      (!sourceHandle || e.sourceHandle === sourceHandle)
    );
    
    return edges.map(e => this.nodeMap.get(e.target)).filter(Boolean);
  }
}

// ============= Convenience Functions =============

export function isWorkflowCompilable(nodes: any[], edges: any[]): boolean {
  const compiler = new StrategyCompiler(nodes, edges);
  return compiler.isCompilable();
}

export function compileWorkflow(nodes: any[], edges: any[]): CompilationResult {
  const compiler = new StrategyCompiler(nodes, edges);
  return compiler.compile();
}
