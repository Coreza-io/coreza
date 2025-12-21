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
    };
  };
}