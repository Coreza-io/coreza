export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      backtest_portfolio_snapshots: {
        Row: {
          backtest_id: string
          cash_balance: number
          created_at: string
          daily_return: number | null
          date: string
          id: string
          stock_value: number
          total_value: number
        }
        Insert: {
          backtest_id: string
          cash_balance: number
          created_at?: string
          daily_return?: number | null
          date: string
          id?: string
          stock_value: number
          total_value: number
        }
        Update: {
          backtest_id?: string
          cash_balance?: number
          created_at?: string
          daily_return?: number | null
          date?: string
          id?: string
          stock_value?: number
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_backtest_portfolio_snapshots_backtest_id"
            columns: ["backtest_id"]
            isOneToOne: false
            referencedRelation: "backtests"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_results: {
        Row: {
          annualized_return: number | null
          average_trade_return: number | null
          avg_holding_period: number | null
          avg_loss: number | null
          avg_win: number | null
          backtest_id: string
          calmar_ratio: number | null
          created_at: string
          expectancy: number | null
          final_portfolio_value: number | null
          id: string
          largest_loss: number | null
          largest_win: number | null
          losing_trades: number | null
          max_drawdown: number | null
          net_profit: number | null
          profit_factor: number | null
          profitable_trades: number | null
          sharpe_ratio: number | null
          sortino_ratio: number | null
          total_commission: number | null
          total_return: number | null
          total_slippage: number | null
          total_trades: number | null
          win_rate: number | null
        }
        Insert: {
          annualized_return?: number | null
          average_trade_return?: number | null
          avg_holding_period?: number | null
          avg_loss?: number | null
          avg_win?: number | null
          backtest_id: string
          calmar_ratio?: number | null
          created_at?: string
          expectancy?: number | null
          final_portfolio_value?: number | null
          id?: string
          largest_loss?: number | null
          largest_win?: number | null
          losing_trades?: number | null
          max_drawdown?: number | null
          net_profit?: number | null
          profit_factor?: number | null
          profitable_trades?: number | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          total_commission?: number | null
          total_return?: number | null
          total_slippage?: number | null
          total_trades?: number | null
          win_rate?: number | null
        }
        Update: {
          annualized_return?: number | null
          average_trade_return?: number | null
          avg_holding_period?: number | null
          avg_loss?: number | null
          avg_win?: number | null
          backtest_id?: string
          calmar_ratio?: number | null
          created_at?: string
          expectancy?: number | null
          final_portfolio_value?: number | null
          id?: string
          largest_loss?: number | null
          largest_win?: number | null
          losing_trades?: number | null
          max_drawdown?: number | null
          net_profit?: number | null
          profit_factor?: number | null
          profitable_trades?: number | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          total_commission?: number | null
          total_return?: number | null
          total_slippage?: number | null
          total_trades?: number | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_backtest_results_backtest_id"
            columns: ["backtest_id"]
            isOneToOne: false
            referencedRelation: "backtests"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_trades: {
        Row: {
          action: string
          backtest_id: string
          commission: number | null
          created_at: string
          entryPrice: number | null
          entryTime: string | null
          exit_reason: string | null
          exitPrice: number
          exitTime: string
          holding_period_bars: number | null
          id: string
          net_pnl: number | null
          portfolio_value_after: number | null
          portfolio_value_before: number | null
          quantity: number
          return_pct: number | null
          slippage: number | null
          symbol: string
        }
        Insert: {
          action: string
          backtest_id: string
          commission?: number | null
          created_at?: string
          entryPrice?: number | null
          entryTime?: string | null
          exit_reason?: string | null
          exitPrice: number
          exitTime: string
          holding_period_bars?: number | null
          id?: string
          net_pnl?: number | null
          portfolio_value_after?: number | null
          portfolio_value_before?: number | null
          quantity: number
          return_pct?: number | null
          slippage?: number | null
          symbol: string
        }
        Update: {
          action?: string
          backtest_id?: string
          commission?: number | null
          created_at?: string
          entryPrice?: number | null
          entryTime?: string | null
          exit_reason?: string | null
          exitPrice?: number
          exitTime?: string
          holding_period_bars?: number | null
          id?: string
          net_pnl?: number | null
          portfolio_value_after?: number | null
          portfolio_value_before?: number | null
          quantity?: number
          return_pct?: number | null
          slippage?: number | null
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_backtest_trades_backtest_id"
            columns: ["backtest_id"]
            isOneToOne: false
            referencedRelation: "backtests"
            referencedColumns: ["id"]
          },
        ]
      }
      backtests: {
        Row: {
          commission_rate: number | null
          completed_at: string | null
          created_at: string
          data_frequency: string
          description: string | null
          end_date: string
          error_message: string | null
          id: string
          initial_capital: number
          name: string
          slippage_rate: number | null
          start_date: string
          started_at: string | null
          status: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          commission_rate?: number | null
          completed_at?: string | null
          created_at?: string
          data_frequency?: string
          description?: string | null
          end_date: string
          error_message?: string | null
          id?: string
          initial_capital?: number
          name: string
          slippage_rate?: number | null
          start_date: string
          started_at?: string | null
          status?: string
          user_id: string
          workflow_id: string
        }
        Update: {
          commission_rate?: number | null
          completed_at?: string | null
          created_at?: string
          data_frequency?: string
          description?: string | null
          end_date?: string
          error_message?: string | null
          id?: string
          initial_capital?: number
          name?: string
          slippage_rate?: number | null
          start_date?: string
          started_at?: string | null
          status?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_backtests_workflow_id"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_snapshots: {
        Row: {
          balances: Json
          base_currency: string | null
          broker: string
          cash: number | null
          created_at: string
          credential_id: string
          equity: number | null
          execution_id: string | null
          id: string
          positions_count: number | null
          realized_pnl: number | null
          snapshot_at: string
          total_value_usdt: number | null
          unrealized_pnl: number | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          balances?: Json
          base_currency?: string | null
          broker: string
          cash?: number | null
          created_at?: string
          credential_id: string
          equity?: number | null
          execution_id?: string | null
          id?: string
          positions_count?: number | null
          realized_pnl?: number | null
          snapshot_at: string
          total_value_usdt?: number | null
          unrealized_pnl?: number | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          balances?: Json
          base_currency?: string | null
          broker?: string
          cash?: number | null
          created_at?: string
          credential_id?: string
          equity?: number | null
          execution_id?: string | null
          id?: string
          positions_count?: number | null
          realized_pnl?: number | null
          snapshot_at?: string
          total_value_usdt?: number | null
          unrealized_pnl?: number | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      live_fills: {
        Row: {
          broker: string
          broker_execution_id: string | null
          commission: number
          commission_asset: string | null
          created_at: string
          credential_id: string
          event_time: string
          execution_id: string | null
          fill_id: string
          fill_status: string | null
          id: string
          order_id: string | null
          price: number
          qty: number
          quote_qty: number | null
          side: string
          symbol: string
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          broker: string
          broker_execution_id?: string | null
          commission?: number
          commission_asset?: string | null
          created_at?: string
          credential_id: string
          event_time: string
          execution_id?: string | null
          fill_id: string
          fill_status?: string | null
          id?: string
          order_id?: string | null
          price: number
          qty: number
          quote_qty?: number | null
          side: string
          symbol: string
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          broker?: string
          broker_execution_id?: string | null
          commission?: number
          commission_asset?: string | null
          created_at?: string
          credential_id?: string
          event_time?: string
          execution_id?: string | null
          fill_id?: string
          fill_status?: string | null
          id?: string
          order_id?: string | null
          price?: number
          qty?: number
          quote_qty?: number | null
          side?: string
          symbol?: string
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      live_trades: {
        Row: {
          action: string
          commission: number | null
          created_at: string
          entry_order_id: string | null
          entryPrice: number | null
          entryTime: string | null
          execution_id: string | null
          exit_order_id: string | null
          exit_reason: string | null
          exitPrice: number
          exitTime: string
          gross_pnl: number | null
          holding_period_bars: number | null
          id: string
          net_pnl: number | null
          quantity: number
          slippage: number | null
          symbol: string
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          action: string
          commission?: number | null
          created_at?: string
          entry_order_id?: string | null
          entryPrice?: number | null
          entryTime?: string | null
          execution_id?: string | null
          exit_order_id?: string | null
          exit_reason?: string | null
          exitPrice: number
          exitTime: string
          gross_pnl?: number | null
          holding_period_bars?: number | null
          id?: string
          net_pnl?: number | null
          quantity: number
          slippage?: number | null
          symbol: string
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          action?: string
          commission?: number | null
          created_at?: string
          entry_order_id?: string | null
          entryPrice?: number | null
          entryTime?: string | null
          execution_id?: string | null
          exit_order_id?: string | null
          exit_reason?: string | null
          exitPrice?: number
          exitTime?: string
          gross_pnl?: number | null
          holding_period_bars?: number | null
          id?: string
          net_pnl?: number | null
          quantity?: number
          slippage?: number | null
          symbol?: string
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      node_executions: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          input_payload: Json
          node_id: string
          output_payload: Json | null
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload: Json
          node_id: string
          output_payload?: Json | null
          run_id: string
          started_at?: string
          status: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          node_id?: string
          output_payload?: Json | null
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_executions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      position_snapshots: {
        Row: {
          avg_entry_price: number
          broker: string
          created_at: string
          credential_id: string
          current_price: number | null
          id: string
          quantity: number
          realized_pnl: number | null
          snapshot_at: string
          symbol: string
          unrealized_pnl: number | null
          user_id: string
        }
        Insert: {
          avg_entry_price: number
          broker: string
          created_at?: string
          credential_id: string
          current_price?: number | null
          id?: string
          quantity: number
          realized_pnl?: number | null
          snapshot_at: string
          symbol: string
          unrealized_pnl?: number | null
          user_id: string
        }
        Update: {
          avg_entry_price?: number
          broker?: string
          created_at?: string
          credential_id?: string
          current_price?: number | null
          id?: string
          quantity?: number
          realized_pnl?: number | null
          snapshot_at?: string
          symbol?: string
          unrealized_pnl?: number | null
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string
          current_period_start: string
          id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string
          current_period_start?: string
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string
          current_period_start?: string
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      usage_metrics: {
        Row: {
          created_at: string | null
          execution_count: number | null
          id: string
          overage_count: number | null
          period_end: string
          period_start: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          execution_count?: number | null
          id?: string
          overage_count?: number | null
          period_end?: string
          period_start?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          execution_count?: number | null
          id?: string
          overage_count?: number | null
          period_end?: string
          period_start?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_credentials: {
        Row: {
          auth_tag: string | null
          client_json: Json | null
          created_at: string | null
          dek_wrapped: string | null
          enc_payload: string | null
          enc_version: number | null
          id: string
          is_encrypted: boolean | null
          iv: string | null
          key_algo: string | null
          key_ref: string | null
          name: string
          scopes: string | null
          service_type: string
          token_json: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auth_tag?: string | null
          client_json?: Json | null
          created_at?: string | null
          dek_wrapped?: string | null
          enc_payload?: string | null
          enc_version?: number | null
          id?: string
          is_encrypted?: boolean | null
          iv?: string | null
          key_algo?: string | null
          key_ref?: string | null
          name: string
          scopes?: string | null
          service_type: string
          token_json?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auth_tag?: string | null
          client_json?: Json | null
          created_at?: string | null
          dek_wrapped?: string | null
          enc_payload?: string | null
          enc_version?: number | null
          id?: string
          is_encrypted?: boolean | null
          iv?: string | null
          key_algo?: string | null
          key_ref?: string | null
          name?: string
          scopes?: string | null
          service_type?: string
          token_json?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          first_name: string
          id: string
          last_name: string
          location: string | null
          phone: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          first_name: string
          id?: string
          last_name: string
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          first_name?: string
          id?: string
          last_name?: string
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          edge_count: number | null
          edges: Json | null
          error_message: string | null
          execution_id: string | null
          id: string
          initiated_by: string | null
          node_count: number | null
          nodes: Json | null
          result: Json | null
          schedule_key: string | null
          started_at: string
          status: string
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          edge_count?: number | null
          edges?: Json | null
          error_message?: string | null
          execution_id?: string | null
          id?: string
          initiated_by?: string | null
          node_count?: number | null
          nodes?: Json | null
          result?: Json | null
          schedule_key?: string | null
          started_at?: string
          status: string
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          edge_count?: number | null
          edges?: Json | null
          error_message?: string | null
          execution_id?: string | null
          id?: string
          initiated_by?: string | null
          node_count?: number | null
          nodes?: Json | null
          result?: Json | null
          schedule_key?: string | null
          started_at?: string
          status?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          change_description: string | null
          created_at: string | null
          created_by: string | null
          edge_count: number
          edges: Json
          id: string
          is_active: boolean | null
          name: string
          node_count: number
          nodes: Json
          version_number: number
          workflow_id: string
        }
        Insert: {
          change_description?: string | null
          created_at?: string | null
          created_by?: string | null
          edge_count: number
          edges: Json
          id?: string
          is_active?: boolean | null
          name: string
          node_count: number
          nodes: Json
          version_number: number
          workflow_id: string
        }
        Update: {
          change_description?: string | null
          created_at?: string | null
          created_by?: string | null
          edge_count?: number
          edges?: Json
          id?: string
          is_active?: boolean | null
          name?: string
          node_count?: number
          nodes?: Json
          version_number?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          active_execution_id: string | null
          created_at: string | null
          edges: Json
          id: string
          is_active: boolean | null
          name: string
          nodes: Json
          persistent_state: Json | null
          project_id: string | null
          schedule_cron: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active_execution_id?: string | null
          created_at?: string | null
          edges: Json
          id?: string
          is_active?: boolean | null
          name: string
          nodes: Json
          persistent_state?: Json | null
          project_id?: string | null
          schedule_cron?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active_execution_id?: string | null
          created_at?: string | null
          edges?: Json
          id?: string
          is_active?: boolean | null
          name?: string
          nodes?: Json
          persistent_state?: Json | null
          project_id?: string | null
          schedule_cron?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_execution_limit: { Args: { p_user_id: string }; Returns: boolean }
      get_current_usage: {
        Args: { p_user_id: string }
        Returns: {
          execution_count: number
          period_end: string
          period_start: string
        }[]
      }
      get_user_tier: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["subscription_tier"]
      }
      increment_execution_count: {
        Args: { p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      subscription_status: "active" | "cancelled" | "expired" | "trial"
      subscription_tier: "free" | "trader" | "professional" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      subscription_status: ["active", "cancelled", "expired", "trial"],
      subscription_tier: ["free", "trader", "professional", "enterprise"],
    },
  },
} as const
