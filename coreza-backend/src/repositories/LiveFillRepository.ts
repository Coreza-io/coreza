/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
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
  fill_kind?: "fill" | "algo";
}

export class LiveFillRepository {
  /**
   * Batch upsert fills using deterministic fill_id for idempotency.
   */
  static async batchUpsert(rows: LiveFillRow[]): Promise<void> {
    if (rows.length === 0) return;

    const { error } = await supabase
      .from("live_fills")
      .upsert(rows, { onConflict: "user_id,broker,symbol,fill_id" });

    if (error) {
      logger.error({ error: error.message, count: rows.length }, "batch upsert failed");
      throw error;
    }

    logger.debug({ count: rows.length }, "fills upserted");
  }
}
