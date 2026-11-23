import type { ReportingTables } from "../reporting/database";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface Database {
  public: {
    Tables: ReportingTables & {
      workflows: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          nodes: any;
          edges: any;
          node_clusters: any;
          revision: number;
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
          node_clusters?: any;
          revision?: number;
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
          node_clusters?: any;
          revision?: number;
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
          node_clusters: any;
          source_workflow_revision: number | null;
          scope_kind: string;
          scope_cluster_id: string | null;
          scope_snapshot: any;
          idempotency_key: string | null;
          request_fingerprint: string | null;
          cancel_requested_at: string | null;
          cancel_acknowledged_at: string | null;
          node_count: number | null;
          edge_count: number | null;
          parent_run_id: string | null;
          bar_sequence: number | null;
          bar_index: number | null;
          bar_symbol: string | null;
          bar_time: string | null;
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
          node_clusters?: any;
          source_workflow_revision?: number | null;
          scope_kind?: string;
          scope_cluster_id?: string | null;
          scope_snapshot?: any;
          idempotency_key?: string | null;
          request_fingerprint?: string | null;
          cancel_requested_at?: string | null;
          cancel_acknowledged_at?: string | null;
          node_count?: number | null;
          edge_count?: number | null;
          parent_run_id?: string | null;
          bar_sequence?: number | null;
          bar_index?: number | null;
          bar_symbol?: string | null;
          bar_time?: string | null;
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
          node_clusters?: any;
          source_workflow_revision?: number | null;
          scope_kind?: string;
          scope_cluster_id?: string | null;
          scope_snapshot?: any;
          idempotency_key?: string | null;
          request_fingerprint?: string | null;
          cancel_requested_at?: string | null;
          cancel_acknowledged_at?: string | null;
          node_count?: number | null;
          edge_count?: number | null;
          parent_run_id?: string | null;
          bar_sequence?: number | null;
          bar_index?: number | null;
          bar_symbol?: string | null;
          bar_time?: string | null;
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
          workflow_run_id: string | null;
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
          workflow_run_id?: string | null;
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
          workflow_run_id?: string | null;
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



    };
    Functions: {
      write_backtest_bar_result_part: {
        Args: { p_row: Record<string, unknown>; p_part_index: number; p_payload: string | null; p_final: boolean };
        Returns: undefined;
      };
      write_backtest_bar_batch: {
        Args: { p_run_id: string; p_rows: Database["public"]["Tables"]["workflow_runs"]["Insert"][] };
        Returns: undefined;
      };
      start_backtest_run: {
        Args: { p_run_id: string; p_workflow_id: string; p_user_id: string };
        Returns: boolean;
      };
      finalize_backtest_run: {
        Args: {
          p_run_id: string;
          p_workflow_id: string;
          p_user_id: string;
          p_status: "success" | "failed";
          p_error_message: string | null;
          p_result: Record<string, unknown> | null;
          p_expected_started_at?: string;
          p_expected_status?: string;
        };
        Returns: string | null;
      };
    };
  };
}
