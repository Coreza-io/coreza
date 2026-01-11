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

export interface DataSourceInput {
  user_id: string;
  credential_id?: string;
  operation: string;
  [key: string]: any;
}

export interface DataSourceResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface IDataSourceService {
  /** Unique identifier (e.g., "fmp", "polygon", "yahoofinance") */
  readonly serviceKey: string;

  /** Execute data source operation */
  execute(input: DataSourceInput): Promise<DataSourceResult>;
}
