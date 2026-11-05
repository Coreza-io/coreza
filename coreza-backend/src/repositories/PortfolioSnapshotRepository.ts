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

const logger = createLogger("PortfolioSnapshotRepository");

export interface PortfolioSnapshotRow {
  id: string;
  user_id: string;
  broker: string;
  credential_id: string;
  snapshot_at: string;
  balances: Record<string, unknown>;
  total_value_usdt?: number;
  workflow_id: string;
  execution_id: string;
  base_currency?: string;
  cash?: number;
  equity?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  positions_count?: number;
}

export class PortfolioSnapshotRepository {
  /**
   * Upsert live activation snapshots into shared portfolio reporting.
   */
  static async batchInsert(rows: PortfolioSnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;
    if (rows.some(row => !row.id)) throw new Error("Snapshot retry ID is required");

    const { error } = await (supabase as any).from("portfolio").upsert(
      rows.map(row => ({ ...row, live_strategy_id: row.execution_id })),
      { onConflict: "id" },
    );

    if (error) {
      logger.error(
        { error: error.message, count: rows.length },
        "snapshot insert failed",
      );
      throw error;
    }

    rows.forEach(row => LiveStrategiesRepository.markDirty(row.execution_id));
    logger.debug({ count: rows.length }, "snapshots inserted");
  }
}
