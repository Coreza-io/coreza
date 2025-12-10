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

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { SimBroker, SimBrokerConfig, Bar } from '../../services/simBroker';
import { supabase } from '../../config/supabase';

export class BacktestExecutor implements INodeExecutor {
  readonly category = 'Backtest';

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const nodeType = node.node_type || node.name;

    switch (nodeType) {
      case 'BacktestInit':
        return this.executeBacktestInit(node, input, context);
      case 'BacktestTrade':
        return this.executeBacktestTrade(node, input, context);
      case 'BacktestSnapshot':
        return this.executeBacktestSnapshot(node, input, context);
      case 'BacktestResults':
        return this.executeBacktestResults(node, input, context);
      case 'BacktestPortfolio':
        return this.executeBacktestPortfolio(node, input, context);
      default:
        return {
          success: false,
          error: `Unknown backtest node type: ${nodeType}`,
        };
    }
  }

  // ============== BACKTEST INIT ==============
  private async executeBacktestInit(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const userId = context?.userId;
      const workflowId = context?.workflowId;

      if (!userId || !workflowId) {
        return { success: false, error: 'User ID and Workflow ID required for backtest' };
      }

      // Parse configuration
      const config: Partial<SimBrokerConfig> = {
        initialCapital: parseFloat(params.initial_capital) || 10000,
        fillModel: params.fill_model || 'next_bar_open',
        slippageModel: params.slippage_model || 'percentage',
        slippageValue: parseFloat(params.slippage_value) || 0.001,
        commissionModel: params.commission_model || 'per_share',
        commissionValue: parseFloat(params.commission_value) || 0.01,
        allowShort: params.allow_short === 'true' || params.allow_short === true,
      };

      // Create backtest session in Supabase
      const supabaseClient = supabase;
      const { data: backtest, error: insertError } = await supabaseClient
        .from('backtests')
        .insert({
          user_id: userId,
          workflow_id: workflowId,
          name: params.name || `Backtest ${new Date().toISOString()}`,
          description: params.description || null,
          status: 'running',
          initial_capital: config.initialCapital,
          commission_rate: config.commissionValue,
          slippage_rate: config.slippageValue,
          start_date: params.start_date || new Date().toISOString().split('T')[0],
          end_date: params.end_date || new Date().toISOString().split('T')[0],
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !backtest) {
        console.error('[BacktestExecutor] Failed to create backtest session:', insertError);
        return { success: false, error: `Failed to create backtest: ${insertError?.message}` };
      }

      const backtestId = backtest.id;

      // Initialize SimBroker with Redis state
      const simBroker = new SimBroker(backtestId, config);
      await simBroker.initializePortfolio();

      console.log(`[BacktestExecutor] Backtest initialized: ${backtestId} with $${config.initialCapital}`);

      return {
        success: true,
        data: {
          backtest_id: backtestId,
          initial_capital: config.initialCapital,
          start_date: params.start_date || new Date().toISOString().split('T')[0],
          end_date: params.end_date || new Date().toISOString().split('T')[0],
          config: {
            fill_model: config.fillModel,
            slippage_model: config.slippageModel,
            slippage_value: config.slippageValue,
            commission_model: config.commissionModel,
            commission_value: config.commissionValue,
            allow_short: config.allowShort,
          },
          status: 'running',
        },
      };
    } catch (error) {
      console.error('[BacktestExecutor] BacktestInit failed:', error);
      return {
        success: false,
        error: `BacktestInit failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============== BACKTEST TRADE ==============
  private async executeBacktestTrade(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return { success: false, error: 'backtest_id is required' };
      }

      const symbol = params.symbol;
      const side = params.side;
      const quantity = parseFloat(params.quantity);
      const orderType = params.order_type || 'market';

      if (!symbol || !side || !quantity) {
        return { success: false, error: 'symbol, side, and quantity are required' };
      }

      // Get SimBroker instance
      const simBroker = new SimBroker(backtestId);

      // Parse current bar from input (passed from loop iteration)
      const currentBar = this.parseBar(params.current_bar || input);

      // If we have a current bar, process pending orders first
      if (currentBar) {
        await simBroker.onBar(symbol, currentBar);
      }

      // Place the new order
      const orderResult = await simBroker.placeOrder({
        symbol,
        side: side as 'buy' | 'sell',
        type: orderType as 'market' | 'limit' | 'stop' | 'stop_limit',
        quantity,
        limitPrice: params.limit_price ? parseFloat(params.limit_price) : undefined,
        stopPrice: params.stop_price ? parseFloat(params.stop_price) : undefined,
      });

      if (!orderResult.success) {
        return { success: false, error: orderResult.error };
      }

      // For immediate fills, process the newly placed order right away
      // This allows market orders to fill at current bar's close price
      if (currentBar && orderResult.status === 'pending') {
        const fills = await simBroker.onBar(symbol, currentBar);
        
        // If order was filled, return fill details
        if (fills.length > 0) {
          const fill = fills.find(f => f.orderId === orderResult.orderId);
          if (fill) {
            const cash = await simBroker.getCash();
            const positions = await simBroker.getPositions();
            
            return {
              success: true,
              data: {
                order_id: orderResult.orderId,
                order_status: 'filled',
                fill_price: fill.price,
                fill_quantity: fill.quantity,
                commission: fill.commission,
                slippage: fill.slippage,
                symbol,
                side,
                quantity,
                order_type: orderType,
                cash,
                positions,
                pending_orders: 0,
              },
            };
          }
        }
      }

      // Get updated state (for pending orders that weren't filled)
      const cash = await simBroker.getCash();
      const positions = await simBroker.getPositions();
      const pendingOrders = await simBroker.getPendingOrders();

      return {
        success: true,
        data: {
          order_id: orderResult.orderId,
          order_status: orderResult.status,
          symbol,
          side,
          quantity,
          order_type: orderType,
          cash,
          positions,
          pending_orders: pendingOrders.length,
        },
      };
    } catch (error) {
      console.error('[BacktestExecutor] BacktestTrade failed:', error);
      return {
        success: false,
        error: `BacktestTrade failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============== BACKTEST SNAPSHOT ==============
  private async executeBacktestSnapshot(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return { success: false, error: 'backtest_id is required' };
      }

      // Parse current bar or prices
      const currentBar = this.parseBar(params.current_bar || input);
      const timestamp = params.timestamp || currentBar?.timestamp || new Date().toISOString();

      // Build prices map from current bar or explicit prices
      const prices: Record<string, number> = {};
      if (currentBar) {
        prices[params.symbol || 'UNKNOWN'] = currentBar.close;
      }
      if (params.prices && typeof params.prices === 'object') {
        Object.assign(prices, params.prices);
      }

      // Get SimBroker and process bar if provided
      const simBroker = new SimBroker(backtestId);
      
      // Process pending orders with current bar
      if (currentBar && params.symbol) {
        await simBroker.onBar(params.symbol, currentBar);
      }

      // Record equity snapshot
      const snapshot = await simBroker.recordSnapshot(timestamp, prices);

      return {
        success: true,
        data: {
          timestamp: snapshot.timestamp,
          cash: snapshot.cash,
          positions_value: snapshot.positionsValue,
          total_equity: snapshot.totalEquity,
          drawdown_pct: snapshot.drawdownPct,
        },
      };
    } catch (error) {
      console.error('[BacktestExecutor] BacktestSnapshot failed:', error);
      return {
        success: false,
        error: `BacktestSnapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============== BACKTEST RESULTS ==============
  private async executeBacktestResults(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return { success: false, error: 'backtest_id is required' };
      }

      // Get SimBroker
      const simBroker = new SimBroker(backtestId);

      // Calculate metrics
      const metrics = await simBroker.getMetrics();
      const trades = await simBroker.getTrades();
      const equityCurve = await simBroker.getEquityCurve();
      const portfolioState = await simBroker.getPortfolioState();

      // Persist to Supabase
      const supabaseClient = supabase;

      // Update backtest status
      await supabaseClient
        .from('backtests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', backtestId);

      // Insert backtest results
      await supabaseClient.from('backtest_results').insert({
        backtest_id: backtestId,
        total_return: metrics.totalReturnPct,
        annualized_return: metrics.annualizedReturn,
        max_drawdown: metrics.maxDrawdownPct,
        sharpe_ratio: metrics.sharpeRatio,
        total_trades: metrics.totalTrades,
        win_rate: metrics.winRate,
        profitable_trades: metrics.winningTrades,
        average_trade_return: metrics.avgTradePnl,
        largest_win: metrics.largestWin,
        largest_loss: metrics.largestLoss,
        final_portfolio_value: portfolioState.cash + Object.values(portfolioState.positions).reduce((sum, p) => sum + p.marketValue, 0),
      });

      // Insert trades
      if (trades.length > 0) {
        const tradeRows = trades.map(t => ({
          backtest_id: backtestId,
          symbol: t.symbol,
          action: t.side,
          quantity: t.quantity,
          price: t.exitPrice,
          timestamp: t.exitTime,
          commission: t.commission,
          slippage: t.slippage,
          portfolio_value_before: null, // Would need to track
          portfolio_value_after: null,
        }));

        await supabaseClient.from('backtest_trades').insert(tradeRows);
      }

      // Insert equity curve samples (limit to avoid too many rows)
      if (equityCurve.length > 0) {
        // Sample every Nth point if too many
        const maxPoints = 500;
        const step = Math.max(1, Math.floor(equityCurve.length / maxPoints));
        const sampledCurve = equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1);

        const snapshotRows = sampledCurve.map(p => ({
          backtest_id: backtestId,
          date: p.timestamp.split('T')[0],
          cash_balance: p.cash,
          stock_value: p.positionsValue,
          total_value: p.totalEquity,
          daily_return: null, // Could calculate
        }));

        await supabaseClient.from('backtest_portfolio_snapshots').insert(snapshotRows);
      }

      // Cleanup Redis state
      await simBroker.cleanup();

      console.log(`[BacktestExecutor] Backtest completed: ${backtestId}, Total Return: ${metrics.totalReturnPct.toFixed(2)}%`);

      return {
        success: true,
        data: {
          backtest_id: backtestId,
          metrics: {
            total_return: metrics.totalReturn,
            total_return_pct: metrics.totalReturnPct,
            annualized_return: metrics.annualizedReturn,
            max_drawdown: metrics.maxDrawdown,
            max_drawdown_pct: metrics.maxDrawdownPct,
            sharpe_ratio: metrics.sharpeRatio,
            sortino_ratio: metrics.sortinoRatio,
            calmar_ratio: metrics.calmarRatio,
            total_trades: metrics.totalTrades,
            winning_trades: metrics.winningTrades,
            losing_trades: metrics.losingTrades,
            win_rate: metrics.winRate,
            profit_factor: metrics.profitFactor,
            avg_win: metrics.avgWin,
            avg_loss: metrics.avgLoss,
            largest_win: metrics.largestWin,
            largest_loss: metrics.largestLoss,
            avg_trade_pnl: metrics.avgTradePnl,
            total_commission: metrics.totalCommission,
            total_slippage: metrics.totalSlippage,
            start_date: metrics.startDate,
            end_date: metrics.endDate,
            total_bars: metrics.totalBars,
          },
          trades_count: trades.length,
          equity_points: equityCurve.length,
          final_equity: portfolioState.cash + Object.values(portfolioState.positions).reduce((sum, p) => sum + p.marketValue, 0),
        },
      };
    } catch (error) {
      console.error('[BacktestExecutor] BacktestResults failed:', error);
      return {
        success: false,
        error: `BacktestResults failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============== BACKTEST PORTFOLIO ==============
  private async executeBacktestPortfolio(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return { success: false, error: 'backtest_id is required' };
      }

      const simBroker = new SimBroker(backtestId);
      const portfolioState = await simBroker.getPortfolioState();

      if (!portfolioState) {
        return { success: false, error: 'Portfolio not found - run BacktestInit first' };
      }

      // Convert positions object to array format
      const positionsArray = Object.values(portfolioState.positions);
      
      // Calculate positions value and P&L totals from stored values
      const positionsValue = positionsArray.reduce((sum, pos) => sum + pos.marketValue, 0);
      const unrealizedPnlTotal = positionsArray.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
      const realizedPnlTotal = positionsArray.reduce((sum, pos) => sum + pos.realizedPnl, 0);

      return {
        success: true,
        data: {
          cash: portfolioState.cash,
          initial_capital: portfolioState.initialCapital,
          positions: positionsArray,
          positions_count: positionsArray.length,
          positions_value: positionsValue,
          unrealized_pnl: unrealizedPnlTotal,
          realized_pnl: realizedPnlTotal,
          total_equity: portfolioState.cash + positionsValue,
          pending_orders: portfolioState.pendingOrders,
          pending_orders_count: portfolioState.pendingOrders.length,
          trades: portfolioState.trades,
          trades_count: portfolioState.trades.length,
        },
      };
    } catch (error) {
      console.error('[BacktestExecutor] BacktestPortfolio failed:', error);
      return {
        success: false,
        error: `BacktestPortfolio failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============== HELPERS ==============
  private parseBar(data: any): Bar | null {
    if (!data) return null;

    // Handle JSON string input
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }

    // Handle various input formats
    if (data.bar) {
      data = data.bar;
    }

    // Get timestamp from multiple possible field names
    const timestamp = data.timestamp || data.date || data.t;

    if (timestamp && data.open !== undefined && data.high !== undefined && 
        data.low !== undefined && data.close !== undefined) {
      return {
        timestamp: timestamp,
        open: parseFloat(data.open || data.o),
        high: parseFloat(data.high || data.h),
        low: parseFloat(data.low || data.l),
        close: parseFloat(data.close || data.c),
        volume: parseFloat(data.volume || data.v || 0),
      };
    }

    // Try OHLCV format
    if (data.t && data.o !== undefined) {
      return {
        timestamp: data.t,
        open: parseFloat(data.o),
        high: parseFloat(data.h),
        low: parseFloat(data.l),
        close: parseFloat(data.c),
        volume: parseFloat(data.v || 0),
      };
    }

    return null;
  }
}
