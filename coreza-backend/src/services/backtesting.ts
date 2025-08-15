import { supabase } from '../config/supabase';
import { ProfessionalBacktestEngine } from './backtesting/ProfessionalBacktestEngine';
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

      // Create professional backtest engine
      const engine = new ProfessionalBacktestEngine(backtest, backtestId);
      
      // Run the backtest
      const metrics = await engine.run();
      
      console.log(`Backtest ${backtestId} completed successfully:`, {
        total_return: (metrics.total_return * 100).toFixed(2) + '%',
        sharpe_ratio: metrics.sharpe_ratio.toFixed(2),
        max_drawdown: (metrics.max_drawdown * 100).toFixed(2) + '%',
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