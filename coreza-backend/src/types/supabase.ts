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