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

const logger = createLogger("LiveFillRepository");

export interface LiveFillRow {
  user_id: string;
  broker: string;
  credential_id: string;
  symbol: string;
  fill_id: string;
  order_id?: string;
  broker_execution_id?: string;
  side: string;
  price: number;
  qty: number;
  quote_qty?: number;
  commission: number;
  commission_asset?: string;
  event_time: string;
  workflow_id?: string;
  execution_id?: string;
  fill_status?: string;
  algo_id?: string;
  order_type?: string;
  limit_price?: number | null;
  stop_price?: number | null;
  trail_percent?: number | null;
  trail_price?: number | null;
  timeInForce?: string | null;
  tag?: string;
}

export class LiveFillRepository {
  /**
   * Batch upsert fills using deterministic fill_id for idempotency.
   */
  static async batchUpsert(rows: LiveFillRow[]): Promise<void> {
    if (rows.length === 0) return;

    const { error } = await supabase
      .from("live_fills")
      .upsert(rows as any, { onConflict: "user_id,broker,symbol,fill_id" });

    if (error) {
      logger.error(
        { error: error.message, count: rows.length },
        "batch upsert failed",
      );
      throw error;
    }

    logger.debug({ count: rows.length }, "fills upserted");
  }
}
