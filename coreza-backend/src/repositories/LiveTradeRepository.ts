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


export interface LiveTradeRow {
  id: string;
  user_id: string;
  workflow_id?: string;
  execution_id?: string;
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
  private static pending = new Map<string, LiveTradeRow>();
  private static writes = new Map<string, Promise<void>>();

  static insert(row: LiveTradeRow): Promise<void> {
    if (!row.execution_id || !row.workflow_id) return Promise.reject(new Error("Closed trade requires an activation identity"));
    const existing = this.writes.get(row.id);
    if (existing) return existing;
    this.pending.set(row.id, row);
    const write = this.persist(row).then(() => { this.pending.delete(row.id); })
      .finally(() => { this.writes.delete(row.id); });
    this.writes.set(row.id, write);
    return write;
  }

  private static async persist(row: LiveTradeRow): Promise<void> {
    const { error } = await (supabase as any).from("trades").upsert({
      ...row, live_strategy_id: row.execution_id,
      commission: row.commission ?? 0, slippage: row.slippage ?? 0,
      holding_period_bars: row.holding_period_bars ?? 0,
    }, { onConflict: "id" });
    if (error) throw error;
    LiveStrategiesRepository.markDirty(row.execution_id!);
  }

  static async flush(executionId?: string, workflowId?: string, userId?: string): Promise<void> {
    const rows = [...this.pending.values()].filter(row => (!executionId || row.execution_id === executionId) && (!workflowId || row.workflow_id === workflowId) && (!userId || row.user_id === userId));
    await Promise.allSettled(rows.map(row => this.writes.get(row.id)));
    for (const row of rows) if (this.pending.has(row.id)) await this.insert(row);
  }
}
