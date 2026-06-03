export interface PaginationConfig {
  enabled: boolean;
  tokenField: string;       // Response field containing next token (e.g., 'next_page_token')
  paramField: string;       // Request param to send token (e.g., 'page_token')
  dataField: string;        // Response field containing data (e.g., 'bars')
  mergeStrategy: 'concat' | 'merge'; // How to merge pages
}

export interface BrokerHttpResponse {
  headers?: Record<string, unknown>;
}

export interface BrokerOperation {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string | ((input: any, creds?: any) => string);
  makeParams?: (input: any, creds?: any) => Record<string, any>;
  makeBody?: (input: any, creds?: any) => any | Promise<any>;
  transformResult?: (data: any, input: any, response?: BrokerHttpResponse) => any;
  pagination?: PaginationConfig;
}

export interface BrokerConfig {
  authType: 'api_key' | 'oauth';
  baseUrl: string | ((creds: any, input?: any) => string);
  makeAuthHeaders: (creds: any) => Record<string, string> | Promise<Record<string, string>>;
  operations: Record<string, BrokerOperation>;
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
  vwap?: number;
  quoteVolume?: number;
  takerBuyBaseVolume?: number;
  takerBuyQuoteVolume?: number;
  closeTime?: number;
}

export interface BarSeriesItem {
  symbol: string;
  interval: string;
  bars: Bar[];
}

export interface BarSeriesOutput {
  BarSeries: BarSeriesItem[];
  next_page_token?: string | null;
  has_more?: boolean;
}

export function toBarSeries(
  symbol: string,
  interval: string,
  bars: Bar[],
  pagination?: { next_page_token?: string | null },
): BarSeriesOutput {
  return {
    BarSeries: [{ symbol, interval, bars }],
    next_page_token: pagination?.next_page_token ?? null,
    has_more: !!pagination?.next_page_token,
  };
}
