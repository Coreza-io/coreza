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
}

export interface IScreenerService {
  /** Unique identifier (e.g., "alpaca", "binance", "manual") */
  readonly screenerKey: string;
  
  /** Execute screener operation */
  execute(input: ScreenerInput): Promise<ScreenerResult>;
}
