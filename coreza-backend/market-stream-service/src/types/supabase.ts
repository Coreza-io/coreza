export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
          client_json: Json | null;
          token_json: Json | null;
          scopes: string | null;
          created_at: string;
          updated_at: string;
          is_encrypted: boolean;
          enc_payload: string | null;
          iv: string | null;
          auth_tag: string | null;
          key_ref: string | null;
          dek_wrapped: string | null;
          enc_version: number | null;
          key_algo: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          service_type: string;
          name: string;
          client_json?: Json | null;
          token_json?: Json | null;
          scopes?: string | null;
          created_at?: string;
          updated_at?: string;
          is_encrypted?: boolean;
          enc_payload?: string | null;
          iv?: string | null;
          auth_tag?: string | null;
          key_ref?: string | null;
          dek_wrapped?: string | null;
          enc_version?: number | null;
          key_algo?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          service_type?: string;
          name?: string;
          client_json?: Json | null;
          token_json?: Json | null;
          scopes?: string | null;
          created_at?: string;
          updated_at?: string;
          is_encrypted?: boolean;
          enc_payload?: string | null;
          iv?: string | null;
          auth_tag?: string | null;
          key_ref?: string | null;
          dek_wrapped?: string | null;
          enc_version?: number | null;
          key_algo?: string | null;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}