export interface PaginationConfig {
  enabled: boolean;
  tokenField: string;       // Response field containing next token (e.g., 'next_page_token')
  paramField: string;       // Request param to send token (e.g., 'page_token')
  dataField: string;        // Response field containing data (e.g., 'bars')
  mergeStrategy: 'concat' | 'merge'; // How to merge pages
}

export interface BrokerOperation {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string | ((input: any, creds?: any) => string);
  makeParams?: (input: any, creds?: any) => Record<string, any>;
  makeBody?: (input: any, creds?: any) => any | Promise<any>;
  transformResult?: (data: any, input: any) => any;
  pagination?: PaginationConfig;
}

export interface BrokerConfig {
  authType: 'api_key' | 'oauth';
  baseUrl: string | ((creds: any, input?: any) => string);
  makeAuthHeaders: (creds: any) => Record<string, string> | Promise<Record<string, string>>;
  operations: Record<string, BrokerOperation>;
}
