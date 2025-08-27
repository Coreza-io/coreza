import { supabase } from '../config/supabase';
import { ProfessionalBacktestEngine } from './backtesting/ProfessionalBacktestEngine';
import { WorkflowBacktestEngine } from './backtesting/WorkflowBacktestEngine';
import { PerformanceMetrics } from './backtesting/types';
import { createError } from '../middleware/errorHandler';

export interface BacktestConfig {
  id?: string;
  user_id: string;
  workflow_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  commission_rate: number;
  slippage_rate: number;
  data_frequency: string;
}

export class BacktestingService {
  
  async createBacktest(config: BacktestConfig): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .insert({
          user_id: config.user_id,
          workflow_id: config.workflow_id,
          name: config.name,
          description: config.description,
          start_date: config.start_date,
          end_date: config.end_date,
          initial_capital: config.initial_capital,
          commission_rate: config.commission_rate,
          slippage_rate: config.slippage_rate,
          data_frequency: config.data_frequency,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        throw createError('Failed to create backtest', 500);
      }

      return data.id;
    } catch (error) {
      throw createError(`Failed to create backtest: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async runBacktest(backtestId: string): Promise<void> {
    try {
      console.log(`Starting professional backtest execution for ${backtestId}`);
      
      // Update status to running
      await supabase
        .from('backtests')
        .update({ 
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', backtestId);

      // Get backtest configuration
      const { data: backtest, error: backtestError } = await supabase
        .from('backtests')
        .select('*')
        .eq('id', backtestId)
        .single();

      if (backtestError || !backtest) {
        throw createError('Backtest not found', 404);
      }

      // Get workflow data (nodes and edges)
      const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('nodes, edges')
        .eq('id', backtest.workflow_id)
        .single();

      if (workflowError || !workflow) {
        throw createError('Failed to load workflow', 404);
      }

      // Create workflow-driven backtest engine with proper parameters
      const engine = new WorkflowBacktestEngine(backtest, workflow.nodes, workflow.edges);
      
      // Run the backtest
      const metrics = await engine.run();
      
      // Save backtest results to database
      await this.saveBacktestResults(backtestId, metrics);

      // Update status to completed
      await supabase
        .from('backtests')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', backtestId);
      
      console.log(`Backtest ${backtestId} completed successfully:`, {
        total_return: metrics.total_return.toFixed(2) + '%',
        sharpe_ratio: metrics.sharpe_ratio.toFixed(2),
        max_drawdown: metrics.max_drawdown.toFixed(2) + '%',
        total_trades: metrics.total_trades
      });

    } catch (error) {
      console.error(`Backtest ${backtestId} failed:`, error);
      
      // Update status to failed
      await supabase
        .from('backtests')
        .update({ 
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString()
        })
        .eq('id', backtestId);
      
      throw error;
    }
  }

  private async saveBacktestResults(backtestId: string, metrics: any): Promise<void> {
    try {
      // Save main results
      await supabase
        .from('backtest_results')
        .upsert({
          backtest_id: backtestId,
          total_return: metrics.total_return,
          annualized_return: metrics.annualized_return,
          final_portfolio_value: metrics.final_portfolio_value,
          total_trades: metrics.total_trades,
          profitable_trades: metrics.profitable_trades,
          win_rate: metrics.win_rate,
          max_drawdown: metrics.max_drawdown,
          sharpe_ratio: metrics.sharpe_ratio,
          largest_win: metrics.largest_win,
          largest_loss: metrics.largest_loss,
          average_trade_return: metrics.average_trade_return
        });

      // Save trades
      if (metrics.trades && metrics.trades.length > 0) {
        const trades = metrics.trades.map((trade: any) => ({
          backtest_id: backtestId,
          timestamp: trade.timestamp,
          symbol: trade.symbol,
          action: trade.action,
          quantity: trade.quantity,
          price: trade.price,
          commission: trade.commission,
          slippage: trade.slippage,
          portfolio_value_before: trade.portfolio_value_before,
          portfolio_value_after: trade.portfolio_value_after
        }));

        // Delete existing trades first
        await supabase
          .from('backtest_trades')
          .delete()
          .eq('backtest_id', backtestId);

        // Insert new trades in batches
        const batchSize = 100;
        for (let i = 0; i < trades.length; i += batchSize) {
          const batch = trades.slice(i, i + batchSize);
          await supabase
            .from('backtest_trades')
            .insert(batch);
        }
      }

      // Save portfolio snapshots
      if (metrics.portfolio_history && metrics.portfolio_history.length > 0) {
        const snapshots = metrics.portfolio_history.map((snapshot: any) => ({
          backtest_id: backtestId,
          date: snapshot.date,
          portfolio_value: snapshot.value,
          daily_return: snapshot.daily_return
        }));

        // Delete existing snapshots first
        await supabase
          .from('backtest_portfolio_snapshots')
          .delete()
          .eq('backtest_id', backtestId);

        // Insert new snapshots in batches
        const batchSize = 100;
        for (let i = 0; i < snapshots.length; i += batchSize) {
          const batch = snapshots.slice(i, i + batchSize);
          await supabase
            .from('backtest_portfolio_snapshots')
            .insert(batch);
        }
      }

      console.log(`✅ Saved backtest results for ${backtestId}`);
    } catch (error) {
      console.error(`❌ Failed to save backtest results for ${backtestId}:`, error);
      throw error;
    }
  }

  async getBacktestResults(backtestId: string, userId: string): Promise<any> {
    try {
      // Get backtest details
      const { data: backtest, error: backtestError } = await supabase
        .from('backtests')
        .select('*')
        .eq('id', backtestId)
        .eq('user_id', userId)
        .single();

      if (backtestError || !backtest) {
        throw createError('Backtest not found', 404);
      }

      // Get results
      const { data: results, error: resultsError } = await supabase
        .from('backtest_results')
        .select('*')
        .eq('backtest_id', backtestId)
        .single();

      // Get trades
      const { data: trades, error: tradesError } = await supabase
        .from('backtest_trades')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('timestamp');

      // Get portfolio snapshots
      const { data: snapshots, error: snapshotsError } = await supabase
        .from('backtest_portfolio_snapshots')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('date');

      return {
        backtest,
        results: results || null,
        trades: trades || [],
        snapshots: snapshots || []
      };
    } catch (error) {
      throw createError(`Failed to get backtest results: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async getUserBacktests(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .select(`
          *,
          workflows(name),
          backtest_results(total_return, final_portfolio_value)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw createError('Failed to get user backtests', 500);
      }

      return data || [];
    } catch (error) {
      throw createError(`Failed to get user backtests: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async deleteBacktest(backtestId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('backtests')
        .delete()
        .eq('id', backtestId)
        .eq('user_id', userId);

      if (error) {
        throw createError('Failed to delete backtest', 500);
      }
    } catch (error) {
      throw createError(`Failed to delete backtest: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async getBacktestProgress(backtestId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .select('status, started_at, completed_at, error_message')
        .eq('id', backtestId)
        .single();

      if (error) {
        throw createError('Failed to get backtest progress', 500);
      }

      return data;
    } catch (error) {
      throw createError(`Failed to get backtest progress: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }
}