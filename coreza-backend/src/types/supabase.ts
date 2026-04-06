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

export interface Database {
  public: {
    Tables: {
      workflows: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          nodes: any;
          edges: any;
          is_active: boolean;
          schedule_cron: string | null;
          project_id: string | null;
          active_execution_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          nodes: any;
          edges: any;
          is_active?: boolean;
          schedule_cron?: string | null;
          project_id?: string | null;
          active_execution_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          nodes?: any;
          edges?: any;
          is_active?: boolean;
          schedule_cron?: string | null;
          project_id?: string | null;
          active_execution_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      workflow_runs: {
        Row: {
          id: string;
          workflow_id: string;
          status: string;
          started_at: string;
          completed_at: string | null;
          error_message: string | null;
          result: any | null;
          initiated_by: string | null;
          execution_id: string | null;
          schedule_key: string | null;
          nodes: any | null;
          edges: any | null;
          node_count: number | null;
          edge_count: number | null;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          status: string;
          started_at?: string;
          completed_at?: string | null;
          error_message?: string | null;
          result?: any | null;
          initiated_by?: string | null;
          execution_id?: string | null;
          schedule_key?: string | null;
          nodes?: any | null;
          edges?: any | null;
          node_count?: number | null;
          edge_count?: number | null;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          status?: string;
          started_at?: string;
          completed_at?: string | null;
          error_message?: string | null;
          result?: any | null;
          initiated_by?: string | null;
          execution_id?: string | null;
          schedule_key?: string | null;
          nodes?: any | null;
          edges?: any | null;
          node_count?: number | null;
          edge_count?: number | null;
        };
      };
      node_executions: {
        Row: {
          id: string;
          run_id: string;
          node_id: string;
          status: string;
          input_payload: any;
          output_payload: any | null;
          error_message: string | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          node_id: string;
          status: string;
          input_payload: any;
          output_payload?: any | null;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          run_id?: string;
          node_id?: string;
          status?: string;
          input_payload?: any;
          output_payload?: any | null;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
      };
      user_credentials: {
        Row: {
          id: string;
          user_id: string;
          service_type: string;
          name: string;
          client_json: any;
          token_json: any;
          scopes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          service_type: string;
          name: string;
          client_json?: any;
          token_json?: any;
          scopes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          service_type?: string;
          name?: string;
          client_json?: any;
          token_json?: any;
          scopes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      backtests: {
        Row: {
          id: string;
          user_id: string;
          workflow_id: string;
          name: string;
          description: string | null;
          start_date: string;
          end_date: string;
          initial_capital: number;
          commission_rate: number | null;
          slippage_rate: number | null;
          data_frequency: string;
          status: string;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          workflow_id: string;
          name: string;
          description?: string | null;
          start_date: string;
          end_date: string;
          initial_capital?: number;
          commission_rate?: number | null;
          slippage_rate?: number | null;
          data_frequency?: string;
          status?: string;
          error_message?: string | null;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          workflow_id?: string;
          name?: string;
          description?: string | null;
          start_date?: string;
          end_date?: string;
          initial_capital?: number;
          commission_rate?: number | null;
          slippage_rate?: number | null;
          data_frequency?: string;
          status?: string;
          error_message?: string | null;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
      };
      backtest_results: {
        Row: {
          id: string;
          backtest_id: string;
          total_return: number | null;
          annualized_return: number | null;
          max_drawdown: number | null;
          sharpe_ratio: number | null;
          sortino_ratio: number | null;
          calmar_ratio: number | null;
          total_trades: number | null;
          win_rate: number | null;
          profitable_trades: number | null;
          losing_trades: number | null;
          average_trade_return: number | null;
          largest_win: number | null;
          largest_loss: number | null;
          final_portfolio_value: number | null;
          profit_factor: number | null;
          avg_win: number | null;
          avg_loss: number | null;
          total_commission: number | null;
          total_slippage: number | null;
          net_profit: number | null;
          expectancy: number | null;
          avg_holding_period: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          backtest_id: string;
          total_return?: number | null;
          annualized_return?: number | null;
          max_drawdown?: number | null;
          sharpe_ratio?: number | null;
          sortino_ratio?: number | null;
          calmar_ratio?: number | null;
          total_trades?: number | null;
          win_rate?: number | null;
          profitable_trades?: number | null;
          losing_trades?: number | null;
          average_trade_return?: number | null;
          largest_win?: number | null;
          largest_loss?: number | null;
          final_portfolio_value?: number | null;
          profit_factor?: number | null;
          avg_win?: number | null;
          avg_loss?: number | null;
          total_commission?: number | null;
          total_slippage?: number | null;
          net_profit?: number | null;
          expectancy?: number | null;
          avg_holding_period?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          backtest_id?: string;
          total_return?: number | null;
          annualized_return?: number | null;
          max_drawdown?: number | null;
          sharpe_ratio?: number | null;
          sortino_ratio?: number | null;
          calmar_ratio?: number | null;
          total_trades?: number | null;
          win_rate?: number | null;
          profitable_trades?: number | null;
          losing_trades?: number | null;
          average_trade_return?: number | null;
          largest_win?: number | null;
          largest_loss?: number | null;
          final_portfolio_value?: number | null;
          profit_factor?: number | null;
          avg_win?: number | null;
          avg_loss?: number | null;
          total_commission?: number | null;
          total_slippage?: number | null;
          net_profit?: number | null;
          expectancy?: number | null;
          avg_holding_period?: number | null;
          created_at?: string;
        };
      };
      backtest_trades: {
        Row: {
          id: string;
          backtest_id: string;
          symbol: string;
          action: string;
          quantity: number;
          price: number;
          timestamp: string;
          commission: number | null;
          slippage: number | null;
          entry_price: number | null;
          exit_reason: string | null;
          holding_period_bars: number | null;
          net_pnl: number | null;
          return_pct: number | null;
          portfolio_value_before: number | null;
          portfolio_value_after: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          backtest_id: string;
          symbol: string;
          action: string;
          quantity: number;
          price: number;
          timestamp: string;
          commission?: number | null;
          slippage?: number | null;
          entry_price?: number | null;
          exit_reason?: string | null;
          holding_period_bars?: number | null;
          net_pnl?: number | null;
          return_pct?: number | null;
          portfolio_value_before?: number | null;
          portfolio_value_after?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          backtest_id?: string;
          symbol?: string;
          action?: string;
          quantity?: number;
          price?: number;
          timestamp?: string;
          commission?: number | null;
          slippage?: number | null;
          entry_price?: number | null;
          exit_reason?: string | null;
          holding_period_bars?: number | null;
          net_pnl?: number | null;
          return_pct?: number | null;
          portfolio_value_before?: number | null;
          portfolio_value_after?: number | null;
          created_at?: string;
        };
      };
      backtest_portfolio_snapshots: {
        Row: {
          id: string;
          backtest_id: string;
          date: string;
          cash_balance: number;
          stock_value: number;
          total_value: number;
          daily_return: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          backtest_id: string;
          date: string;
          cash_balance: number;
          stock_value: number;
          total_value: number;
          daily_return?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          backtest_id?: string;
          date?: string;
          cash_balance?: number;
          stock_value?: number;
          total_value?: number;
          daily_return?: number | null;
          created_at?: string;
        };
      };
    };
  };
}
