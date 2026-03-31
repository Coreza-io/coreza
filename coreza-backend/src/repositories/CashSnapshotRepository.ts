/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { supabase } from "../config/supabase";
import { createLogger } from "../utils/logger";

const logger = createLogger("CashSnapshotRepository");

export interface CashSnapshotRow {
  user_id: string;
  broker: string;
  credential_id: string;
  snapshot_at: string;
  balances: Record<string, unknown>;
  total_value_usdt?: number;
  workflow_id?: string;
  run_id?: string;
  base_currency?: string;
  cash?: number;
  equity?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  positions_count?: number;
}

export class CashSnapshotRepository {
  /**
   * Batch insert cash snapshots.
   */
  static async batchInsert(rows: CashSnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;

    const { error } = await supabase
      .from("cash_snapshots")
      .insert(rows);

    if (error) {
      logger.error({ error: error.message, count: rows.length }, "snapshot insert failed");
      throw error;
    }

    logger.debug({ count: rows.length }, "snapshots inserted");
  }
}
