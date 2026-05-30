/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface ScreenerInput {
  user_id: string;
  credential_id?: string; // Optional for manual screeners
  operation: string; // e.g., "most_actives", "market_movers", "top_gainers"
  [key: string]: any; // Additional params (market_type, top, filters, etc.)
}

export interface ScreenerResult {
  success: boolean;
  data?: {
    stocks?: any[];
    gainers?: any[];
    losers?: any[];
    most_actives?: any[];
    count?: number;
    metadata?: any;
  };
  error?: string;
  code?: string;
  provider?: string;
  recoverable?: boolean;
}

export interface IScreenerService {
  /** Unique identifier (e.g., "alpaca", "binance", "manual") */
  readonly screenerKey: string;
  
  /** Execute screener operation */
  execute(input: ScreenerInput): Promise<ScreenerResult>;
}
