/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
