/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { getRedisCache } from "../config/redis";
import { createLogger } from "../utils/logger";
import { RedisKeys } from "../infra/redisKeys";

const logger = createLogger("FillEventBus");

export interface FillStreamEvent {
  event_id: string;
  user_id: string;
  workflow_id: string;
  execution_id?: string;
  broker: string;
  credential_id?: string;
  symbol: string;
  side: "buy" | "sell";
  order_id?: string;
  broker_execution_id?: string;
  fill_qty_delta: number;
  fill_price: number;
  quote_qty?: number;
  commission?: number;
  commission_asset?: string;
  event_time: string;
  base_currency?: string;
}

const STREAM_MAX_LEN = "100000";

export class FillEventBus {
  /**
   * Append a fill event to the workflow-scoped Redis stream.
   * Fire-and-forget — caller should NOT await this.
   */
  static async publish(event: FillStreamEvent): Promise<void> {
    const redis = getRedisCache();
    const streamKey = RedisKeys.portfolioFillsStream(event.user_id, event.workflow_id);
    const activeStreamsKey = RedisKeys.userActiveFillStreams(event.user_id);

    // Flatten event to string key-value pairs for XADD
    const fields: string[] = [];
    for (const [k, v] of Object.entries(event)) {
      if (v !== undefined && v !== null) {
        fields.push(k, String(v));
      }
    }

    const pipeline = redis.pipeline();
    pipeline.sadd(activeStreamsKey, streamKey);
    pipeline.sadd(RedisKeys.registryFillsActive(), event.user_id);
    pipeline.xadd(streamKey, "MAXLEN", "~", STREAM_MAX_LEN, "*", ...fields);
    await pipeline.exec();

    logger.debug({ streamKey, eventId: event.event_id }, "fill event published");
  }
}
