/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { NodeResultError } from "../contracts/nodeResult";
import { formatInTimeZone } from "date-fns-tz";
import { getBrokerConfig } from "../brokers";
import { BrokerExecutor } from "../nodes/executors/BrokerExecutor";
import type { Bar } from "../brokers/types";
import type { NodeInput, WorkflowNode } from "../nodes/types";
import { parseTimeframe } from "../utils/timeframe";
import { candleTimestamp } from "./normalizeCandles";

export interface HistoricalDataContext {
  userId?: string;
  workflowId?: string;
  runId?: string;
  workflowSessionId?: string;
  abortSignal?: AbortSignal;
}

interface HistoricalRequestBase {
  provider: string;
  symbol: string;
  interval: string;
  assetType?: string;
  feed?: string;
  adjustment?: string;
  credentialId?: string;
  pageSize?: unknown;
}

export interface HistoricalRangeRequest extends HistoricalRequestBase {
  start: string | Date;
  end: string | Date;
}

export interface PreviousBarsRequest extends HistoricalRequestBase {
  count: number;
  endExclusive: string | Date;
}

export type HistoricalBar = Omit<Bar, "time"> & { time?: number; t?: number };

type BrokerCandleExecutor = Pick<BrokerExecutor, "execute">;

const MAX_ATTEMPTS = 4;
const DAY_MS = 86_400_000;

export function historicalBarTimestamp(bar: Partial<HistoricalBar>): number {
  return bar.time ?? bar.t ?? bar.closeTime ?? NaN;
}

export function normalizeHistoricalBars(bars: HistoricalBar[]): HistoricalBar[] {
  const byTimestamp = new Map<number, HistoricalBar>();
  for (const bar of bars) {
    try {
      const timestamp = candleTimestamp(historicalBarTimestamp(bar), "milliseconds");
      byTimestamp.set(timestamp, { ...bar, time: timestamp });
    } catch {
      // An invalid timestamp cannot participate in chronological alignment.
    }
  }
  return [...byTimestamp.values()].sort(
    (left, right) => historicalBarTimestamp(left) - historicalBarTimestamp(right),
  );
}

function initialLookbackMs(request: PreviousBarsRequest): number {
  let intervalMs = DAY_MS;
  try {
    intervalMs = parseTimeframe(request.interval).milliseconds;
  } catch {
    // Preserve the historical service's conservative fallback for provider-specific intervals.
  }
  const assetType = String(request.assetType ?? "").toLowerCase();
  if (assetType === "crypto") return Math.ceil(request.count * intervalMs * 1.15) + DAY_MS;
  if (intervalMs >= DAY_MS) return (Math.ceil(request.count * 1.6) + 10) * DAY_MS;

  // US-session estimate includes weekends and non-trading hours. Subsequent
  // attempts expand this window, so this estimate never determines correctness.
  const barsPerSession = Math.max(1, Math.floor(6.5 * 3_600_000 / intervalMs));
  return (Math.ceil(request.count / barsPerSession * 1.6) + 10) * DAY_MS;
}

export class HistoricalDataService {
  constructor(private readonly brokerExecutor: BrokerCandleExecutor = new BrokerExecutor()) {}

  async fetchRange(
    request: HistoricalRangeRequest,
    context: HistoricalDataContext,
  ): Promise<HistoricalBar[]> {
    if (request.provider !== "binance") return this.fetchPage(request, context);

    // Binance accepts at most 1000 bars and pages by candle open time.
    const limit = 1000;
    let start = new Date(request.start).getTime();
    const end = new Date(request.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid Binance candle range");
    const bars: HistoricalBar[] = [];
    while (start <= end) {
      const page = await this.fetchPage({ ...request, start: new Date(start), pageSize: limit }, context);
      bars.push(...page);
      if (page.length < limit) break;
      const latest = historicalBarTimestamp(page[page.length - 1]);
      if (latest < start) throw new Error(`Binance historical data pagination stalled for ${request.symbol}`);
      start = latest + 1;
    }
    return normalizeHistoricalBars(bars);
  }

  private async fetchPage(
    request: HistoricalRangeRequest,
    context: HistoricalDataContext,
  ): Promise<HistoricalBar[]> {
    context.abortSignal?.throwIfAborted();
    const formatDate = (value: string | Date) => typeof value === "string" ? value
      : request.provider === "dhan"
        ? formatInTimeZone(value, "Asia/Kolkata", /(?:d|day)$/i.test(request.interval) ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss")
        : value.toISOString();
    const start = formatDate(request.start);
    const end = formatDate(request.end);
    const providerPageSize = getBrokerConfig(request.provider)?.operations.get_candle?.pagination?.pageSize;
    const suppliedPageSize = typeof request.pageSize === "string" && !request.pageSize.trim() ? undefined : request.pageSize;
    // Only providers declaring this capability consume the editable page-size setting.
    const pageSize = request.provider === "binance" ? request.pageSize
      : providerPageSize === undefined ? "50000" : suppliedPageSize ?? providerPageSize;
    const input: NodeInput = {
      operation: "get_candle",
      symbol: request.symbol,
      interval: request.interval,
      start,
      end,
      ...(request.provider === "binance" ? { startTime: start, endTime: end } : {}),
      asset_type: request.assetType,
      feed: request.feed,
      adjustment: request.adjustment,
      credential_id: request.credentialId,
      // Preserve the supplied type so broker validation cannot accept an array such as [1000] as "1000".
      limit: pageSize,
    };
    const node: WorkflowNode = {
      id: `broker:${request.provider}:get_candle:${request.symbol}`,
      name: request.provider,
      node_type: "main",
      category: "Broker",
      subCategory: request.provider,
      values: input,
    };
    const result = await this.brokerExecutor.execute(node, input, {
      userId: context.userId,
      workflowId: context.workflowId || "backtest-init",
      runId: context.runId || context.workflowSessionId || `backtest-${Date.now()}`,
      abortSignal: context.abortSignal,
    });
    context.abortSignal?.throwIfAborted();
    if (result.status !== "success") {
      throw new NodeResultError({ ...result,
        error: `Historical data request failed (provider=${request.provider}, symbol=${request.symbol}, interval=${request.interval}, range=${input.start}..${input.end}): ${result.error}`,
      });
    }
    if (result.data?.pagination_complete === false || result.data?.has_more === true) {
      throw new NodeResultError({ ...result, status: "error", data: null,
        error: `Historical data pagination is incomplete (provider=${request.provider}, symbol=${request.symbol}). Increase Page Size or reduce the requested range before running the backtest.`,
      });
    }
    const bars = result.data?.BarSeries?.[0]?.bars;
    return normalizeHistoricalBars(Array.isArray(bars) ? bars : []);
  }

  async fetchPreviousBars(
    request: PreviousBarsRequest,
    context: HistoricalDataContext,
  ): Promise<HistoricalBar[]> {
    const count = Math.max(0, Math.floor(request.count));
    if (count === 0) return [];
    const boundary = new Date(request.endExclusive).getTime();
    if (!Number.isFinite(boundary)) throw new Error(`Invalid endExclusive: ${request.endExclusive}`);

    let lookbackMs = initialLookbackMs(request);
    let eligible: HistoricalBar[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const bars = await this.fetchRange(
          { ...request, start: new Date(boundary - lookbackMs), end: new Date(boundary) },
          context,
        );
        eligible = bars.filter((bar) => historicalBarTimestamp(bar) < boundary);
        if (eligible.length >= count) return eligible.slice(-count);
      } catch (error) {
        const message = `Previous-bars request failed (provider=${request.provider}, symbol=${request.symbol}, interval=${request.interval}, range=${new Date(boundary - lookbackMs).toISOString()}..${new Date(boundary).toISOString()}, attempt=${attempt}/${MAX_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`;
        throw error instanceof NodeResultError ? new NodeResultError({ ...error.result, error: message }) : new Error(message);
      }
      lookbackMs *= 2;
    }
    console.warn(`[HistoricalDataService] Only ${eligible.length}/${count} pre-start bars available for ${request.symbol}`);
    return eligible.slice(-count);
  }
}
