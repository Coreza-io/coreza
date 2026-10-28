import { reportingTradeId } from "../reporting/persistence";
import { LiveStrategiesRepository } from "./LiveStrategiesRepository";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { supabase } from "../config/supabase";
import { createLogger } from "../utils/logger";

const logger = createLogger("CashSnapshotRepository");

export interface CashSnapshotRow {
  id?: string;
  user_id: string;
  broker: string;
  credential_id: string;
  snapshot_at: string;
  balances: Record<string, unknown>;
  total_value_usdt?: number;
  workflow_id?: string;
  execution_id?: string;
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

    const scoped = rows.filter(row => row.workflow_id && row.execution_id);
    const account = rows.filter(row => !row.workflow_id || !row.execution_id);
    if (account.length) {
      const { error } = await supabase.from("cash_snapshots").insert(account as any);
      if (error) throw error;
    }
    if (!scoped.length) return;
    const { error } = await (supabase as any).from("portfolio").upsert(
      scoped.map(row => ({ ...row, id: row.id ?? reportingTradeId(row.execution_id!, JSON.stringify(row)), live_strategy_id: row.execution_id })),
      { onConflict: "id" },
    );

    if (error) {
      logger.error(
        { error: error.message, count: rows.length },
        "snapshot insert failed",
      );
      throw error;
    }

    scoped.forEach(row => LiveStrategiesRepository.markDirty(row.execution_id!));
    logger.debug({ count: rows.length }, "snapshots inserted");
  }
}
