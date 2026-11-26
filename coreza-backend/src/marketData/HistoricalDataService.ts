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
import { getBrokerConfig } from "../brokers";
import { BrokerExecutor } from "../nodes/executors/BrokerExecutor";
import type { HistoricalBar, HistoricalCandlePage } from "../brokers/types";
import type { NodeInput, WorkflowNode } from "../nodes/types";
import { parseTimeframe } from "../utils/timeframe";
import { historicalBarTimestamp, normalizeHistoricalBars } from "./normalizeCandles";

export type { HistoricalBar } from "../brokers/types";
export { historicalBarTimestamp, normalizeHistoricalBars } from "./normalizeCandles";

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

type BrokerCandleExecutor = Pick<BrokerExecutor, "execute">;

const MAX_ATTEMPTS = 4;
const DAY_MS = 86_400_000;

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
    const broker = getBrokerConfig(request.provider);
    const providerPageSize = broker?.operations?.get_candle?.pagination?.pageSize;
    const fetchPage = (page: HistoricalCandlePage) =>
      this.fetchPage(request, page, providerPageSize, context);
    const fetchProviderRange = broker?.historicalCandles?.fetchRange;
    const bars = fetchProviderRange
      ? await fetchProviderRange(request, fetchPage)
      : await fetchPage(request);
    return normalizeHistoricalBars(bars);
  }

  private async fetchPage(
    request: HistoricalRangeRequest,
    page: HistoricalCandlePage,
    providerPageSize: number | undefined,
    context: HistoricalDataContext,
  ): Promise<HistoricalBar[]> {
    context.abortSignal?.throwIfAborted();
    const start = page.start instanceof Date ? page.start.toISOString() : page.start;
    const end = page.end instanceof Date ? page.end.toISOString() : page.end;
    const suppliedPageSize = typeof request.pageSize === "string" && !request.pageSize.trim() ? undefined : request.pageSize;
    // Preserve the supplied type for broker validation when the page size is configurable.
    const pageSize = page.limit ?? (providerPageSize === undefined ? "50000" : suppliedPageSize ?? providerPageSize);
    const input: NodeInput = {
      ...page.parameters,
      operation: "get_candle",
      symbol: request.symbol,
      interval: page.interval,
      start,
      end,
      asset_type: request.assetType,
      feed: request.feed,
      adjustment: request.adjustment,
      credential_id: request.credentialId,
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
    return Array.isArray(bars) ? bars : [];
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
