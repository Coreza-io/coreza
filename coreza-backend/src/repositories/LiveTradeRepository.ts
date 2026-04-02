/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { supabase } from "../config/supabase";
import { createLogger } from "../utils/logger";

const logger = createLogger("LiveTradeRepository");

export interface LiveTradeRow {
  user_id: string;
  workflow_id?: string;
  run_id?: string;
  symbol: string;
  action: string;
  quantity: number;
  entryPrice?: number;
  entryTime?: string;
  exitPrice: number;
  exitTime: string;
  commission?: number;
  slippage?: number;
  net_pnl?: number;
  gross_pnl?: number;
  entry_order_id?: string;
  exit_order_id?: string;
  holding_period_bars?: number;
  exit_reason?: string;
}

export class LiveTradeRepository {
  /**
   * Insert a single closed trade into the live_trades table.
   */
  static async insert(row: LiveTradeRow): Promise<void> {
    const { error } = await supabase
      .from("live_trades")
      .insert({
        user_id: row.user_id,
        workflow_id: row.workflow_id,
        run_id: row.run_id,
        symbol: row.symbol,
        action: row.action,
        quantity: row.quantity,
        entryPrice: row.entryPrice,
        entryTime: row.entryTime,
        exitPrice: row.exitPrice,
        exitTime: row.exitTime,
        commission: row.commission ?? 0,
        slippage: row.slippage ?? 0,
        net_pnl: row.net_pnl,
        gross_pnl: row.gross_pnl,
        entry_order_id: row.entry_order_id,
        exit_order_id: row.exit_order_id,
        holding_period_bars: row.holding_period_bars ?? 0,
        exit_reason: row.exit_reason,
      });

    if (error) {
      logger.error({ error: error.message, symbol: row.symbol }, "live trade insert failed");
      throw error;
    }

    logger.debug({ symbol: row.symbol, net_pnl: row.net_pnl }, "live trade inserted");
  }
}
